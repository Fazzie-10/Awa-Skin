#!/usr/bin/env python3
"""
Nigerian-first enrichment pipeline for AWA SKIN.

Makes the `nigerian_prices` table self-contained: every face product row gets its
own `raw_ingredients` (jsonb array of INCI strings) and `image_url` (text) so the
recommendation engine can match ingredient names directly against this table.

Tiers (run in order unless --tier is given):
  tier0        Re-categorize Other/Uncategorized rows into
               Cleanse/Treat/Moisturize/Protect via Gemini (batch classify).
  teeka4       Scrape INCI lists directly from Teeka4 product pages
               (the description panel contains an "Ingredients:" / "INGREDIENTS"
               section; "KEY INGREDIENTS" marketing text is rejected).
  gemini       Gemini INCI lookup with hallucination guard:
               {"known":true,"ingredients":[...]}  OR  {"known":false}.
  incidecoder  INCIDecoder brand-slug crawler fallback for rows still without
               ingredients; brand must be in BRANDS_SLUGS and the best name
               match must score >= 0.75 (token-overlap similarity).
  images       Scrape each shop product page's og:image meta tag.

Usage:
  python scripts/enrich_nigerian_prices.py [--limit N] [--tier NAME] [--dry-run]

  --limit N     cap the number of rows processed PER TIER (for smoke testing).
                Default: no limit.
  --tier NAME   run only one tier (e.g. --tier teeka4). Default: all tiers.
  --dry-run     perform all fetching/parsing but skip database writes.

Env is loaded manually from awa-skin/.env.local (fallback: .env.local):
  NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEYS.

PostgREST notes: rows are paginated with the Range header (1000/page), writes are
PATCH /rest/v1/nigerian_prices?id=eq.<id> with Prefer: resolution=merge-duplicates.
"""

import argparse
import html
import json
import os
import random
import re
import sys
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
for _p in (REPO_ROOT, SCRIPT_DIR):
    if _p not in sys.path:
        sys.path.insert(0, _p)

FACE_STEPS = {"cleanse", "treat", "moisturize", "protect"}
TEEKA4 = "teeka4"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
PAGE_DELAY = (0.25, 0.6)
TIER0_BATCH = 50
INCIDECODER_MAX_PRODUCTS_PER_BRAND = 40
INCIDECODER_DELAY = (0.75, 1.0)
NAME_MATCH_THRESHOLD = 0.75
MIGRATION_MISSING = {"flag": False}
_PRINT_LOCK = threading.Lock()
_STATS_LOCK = threading.Lock()

_MIGRATION_MESSAGE = (
    "[Enrich] DATABASE ERROR: the nigerian_prices table is missing the "
    "raw_ingredients / image_url column.\n"
    "  Run this migration in the Supabase Dashboard (SQL editor) first:\n"
    "    awa-skin/sql/add_enrichment_columns.sql\n"
    "  Which executes:\n"
    "    ALTER TABLE nigerian_prices ADD COLUMN IF NOT EXISTS raw_ingredients jsonb;\n"
    "    ALTER TABLE nigerian_prices ADD COLUMN IF NOT EXISTS image_url text;"
)


# ---------------------------------------------------------------------------
# Env + logging helpers
# ---------------------------------------------------------------------------
def load_env_file(path):
    env = {}
    if not os.path.exists(path):
        return env
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            m = re.match(r"^([A-Z0-9_]+)=(.*)$", line.strip())
            if m:
                env[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return env


def log_row(row, tier, status, detail=""):
    shop = row.get("source_shop") or "?"
    name = (row.get("product_name") or "")[:70]
    suffix = " | " + detail if detail else ""
    with _PRINT_LOCK:
        print(f"[Enrich] {shop} | {name} | {tier} {status}{suffix}", flush=True)


def _norm(s):
    return " ".join(re.findall(r"[a-z0-9]+", (s or "").lower()))


def _is_face(row):
    return str(row.get("core_step") or "").lower() in FACE_STEPS


def _norm_core_step(s):
    step = str(s or "").strip().lower()
    for canonical in ("Cleanse", "Treat", "Moisturize", "Protect", "Other", "Uncategorized"):
        if step == canonical.lower():
            return canonical
    return None


def name_similarity(a, b):
    na, nb = _norm(a), _norm(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    as_, bs = na.split(), nb.split()
    overlap = len(set(as_) & set(bs))
    return overlap / min(len(as_), len(bs))


# ---------------------------------------------------------------------------
# Supabase REST access (paginated reads + PATCH writes)
# ---------------------------------------------------------------------------
def fetch_all_rows(base_url, key):
    headers = {"apikey": key, "Authorization": "Bearer " + key, "Range-Unit": "items"}
    rows = []
    offset = 0
    while True:
        resp = requests.get(
            f"{base_url}/rest/v1/nigerian_prices?select=*",
            headers={**headers, "Range": f"{offset}-{offset + 999}"},
            timeout=60,
        )
        resp.raise_for_status()
        batch = resp.json()
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return rows


def _is_missing_column(resp_text):
    low = resp_text.lower()
    return (
        "42703" in low
        or (("raw_ingredients" in low or "image_url" in low) and "column" in low)
    )


def patch_row(base_url, key, row_id, payload):
    headers = {
        "apikey": key,
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }
    try:
        resp = requests.patch(
            f"{base_url}/rest/v1/nigerian_prices?id=eq.{row_id}",
            headers=headers, json=payload, timeout=30,
        )
    except Exception as e:
        return "ERROR", str(e)
    if resp.status_code in (200, 204):
        return "OK", None
    body = resp.text
    if _is_missing_column(body):
        MIGRATION_MISSING["flag"] = True
        return "COLUMN_MISSING", body
    return "ERROR", f"{resp.status_code} {body[:200]}"


# ---------------------------------------------------------------------------
# Gemini client: key rotation + 429 backoff + model fallback
# (pattern from scripts/agentic_categorize.py)
# ---------------------------------------------------------------------------
class GeminiClient:
    def __init__(self, api_keys, base="https://generativelanguage.googleapis.com/v1beta"):
        self.keys = [k.strip() for k in api_keys if k.strip()]
        self.models = ["gemini-3.5-flash", "gemini-2.0-flash", "gemini-flash-latest"]
        self.base = base
        self.exhausted = False

    def generate(self, prompt, temperature=0.1, json_mode=True, max_attempts=12):
        if self.exhausted or not self.keys:
            return None
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": temperature},
        }
        if json_mode:
            payload["generationConfig"]["response_mime_type"] = "application/json"
        headers = {"Content-Type": "application/json"}
        consecutive_429 = 0
        consecutive_model_err = 0
        for attempt in range(max_attempts):
            model = self.models[attempt % len(self.models)]
            key = self.keys[attempt % len(self.keys)]
            url = f"{self.base}/models/{model}:generateContent?key={key}"
            try:
                resp = requests.post(url, headers=headers, json=payload, timeout=60)
                if resp.status_code in (429, 503):
                    consecutive_429 += 1
                    consecutive_model_err = 0
                    if consecutive_429 >= len(self.keys):
                        self.exhausted = True
                        print(f"[Enrich] Gemini: quota/rate limit hit on all {len(self.keys)} "
                              f"keys. Stopping Gemini use.")
                        return None
                    print(f"[Enrich] Gemini {resp.status_code} on {model} (key "
                          f"{attempt % len(self.keys) + 1}). Backoff 30s + rotate key.")
                    time.sleep(30)
                    continue
                if resp.status_code in (400, 403, 404):
                    consecutive_model_err += 1
                    consecutive_429 = 0
                    if consecutive_model_err >= len(self.models):
                        print(f"[Enrich] Gemini: request rejected by all models "
                              f"({resp.status_code}). Giving up on this call.")
                        return None
                    time.sleep(2)
                    continue
                resp.raise_for_status()
                consecutive_429 = 0
                data = resp.json()
                parts = ((data.get("candidates") or [{}])[0]
                         .get("content", {}).get("parts") or [])
                if not parts:
                    return None
                text = parts[0].get("text") or ""
                if json_mode:
                    try:
                        return self._parse_json(text)
                    except Exception:
                        return None
                return text
            except requests.exceptions.RequestException:
                consecutive_429 = 0
                time.sleep(3)
        return None

    @staticmethod
    def _parse_json(text):
        text = (text or "").strip()
        m = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
        if m:
            text = m.group(1).strip()
        starts = [i for i in (text.find("{"), text.find("[")) if i != -1]
        if starts and min(starts) > 0:
            text = text[min(starts):]
        return json.loads(text)


def gemini_inci(client, row):
    name = row.get("product_name") or ""
    brand = row.get("brand") or ""
    prompt = (
        "You are a skincare ingredient expert. Consider the exact skincare product below, "
        "sold in Nigeria.\n\n"
        f"Product name: {name}\n"
        f"Brand: {brand}\n\n"
        'If you know the REAL, full INCI ingredient list for this exact product, '
        'respond ONLY with JSON:\n'
        '{"known": true, "ingredients": ["Ingredient 1", "Ingredient 2", ...]}\n\n'
        "Use the complete, correct INCI list, in order, as comma-separated ingredient names "
        '(e.g. "Water", "Glycerin", ...).\n\n'
        'If you do NOT know the real full INCI list for this exact product, respond ONLY with JSON:\n'
        '{"known": false}\n\n'
        "Never guess or invent ingredients. When unsure, always return known:false."
    )
    data = client.generate(prompt)
    if not isinstance(data, dict):
        return None
    if not data.get("known"):
        return None
    ingredients = [str(x).strip() for x in (data.get("ingredients") or [])]
    ingredients = [x for x in ingredients if x]
    return ingredients if ingredients else None


# ---------------------------------------------------------------------------
# Tier 0: batch re-categorization (reuse scripts/agentic_categorize.classify_batch)
# ---------------------------------------------------------------------------
_CLASSIFY_PROMPT = """
You are a skincare expert AI. I will provide a list of skincare product names.
Your task is to classify EACH product into a Core Step and a Sub-Category.

Core Steps allowed: ["Cleanse", "Treat", "Moisturize", "Protect", "Other", "Uncategorized"]
- Treat includes serums, toners, essences, acids, masks.
- Protect includes sunscreens/SPF.

Sub-Categories allowed: ["Face", "Body", "Lip Care", "Eye Care", "Hair Care", "Makeup", "Unknown"]

Respond ONLY with a valid JSON array of objects. Do not include markdown formatting or backticks like ```json.
The JSON array should contain exactly one object per product in the exact order they were provided.
Each object must have the keys: "product_name", "core_step", "sub_category".

Products to classify:
"""


def local_classify_batch(client, names):
    result = {}
    prompt = _CLASSIFY_PROMPT + "\n".join(f"- {n}" for n in names)
    data = client.generate(prompt)
    if not isinstance(data, list):
        return result
    for item in data:
        if isinstance(item, dict) and item.get("product_name"):
            result[item["product_name"]] = {
                "core_step": item.get("core_step", "Uncategorized"),
                "sub_category": item.get("sub_category", "Unknown"),
            }
    return result


def get_classify_batch(client):
    if os.environ.get("GEMINI_API_KEYS"):
        try:
            from agentic_categorize import classify_batch
            print("[Enrich] Tier 0: using scripts/agentic_categorize.classify_batch")
            return classify_batch
        except Exception as e:
            print(f"[Enrich] Tier 0: agentic_categorize not usable ({e}); using in-script fallback")
    return lambda names: local_classify_batch(client, names)


def run_tier0(rows, args, base_url, key, client, classify_batch):
    candidates = [r for r in rows
                  if str(r.get("core_step") or "uncategorized").lower() in {"other", "uncategorized"}]
    if args.limit:
        candidates = candidates[:args.limit]
    if not candidates:
        print("[Enrich] Tier 0: no Other/Uncategorized rows.")
        return 0
    print(f"[Enrich] Tier 0: re-categorizing {len(candidates)} Other/Uncategorized rows via Gemini")
    changed = 0
    for i in range(0, len(candidates), TIER0_BATCH):
        batch = candidates[i:i + TIER0_BATCH]
        names = [r.get("product_name") for r in batch]
        try:
            result_map = classify_batch(names)
        except Exception as e:
            print(f"[Enrich] Tier 0: batch classify raised: {e}")
            result_map = None
        if not result_map:
            print("[Enrich] Tier 0: classify_batch returned nothing (quota/error). Stopping tier 0.")
            break
        for row in batch:
            cls = result_map.get(row.get("product_name")) or {}
            new_step = _norm_core_step(cls.get("core_step"))
            old_step = row.get("core_step")
            if not new_step or new_step.lower() == (old_step or "").lower():
                continue
            row["core_step"] = new_step
            if args.dry_run:
                changed += 1
                log_row(row, "tier0", "OK (dry-run)", f"core_step -> {new_step}")
                continue
            status, err = patch_row(base_url, key, row["id"], {"core_step": new_step})
            if status == "OK":
                changed += 1
                log_row(row, "tier0", "OK", f"core_step -> {new_step}")
            elif status == "COLUMN_MISSING":
                log_row(row, "tier0", "FAIL", "column-missing (unexpected for core_step)")
                print(_MIGRATION_MESSAGE)
                return changed
            else:
                log_row(row, "tier0", "FAIL", err)
        time.sleep(0.5)
    print(f"[Enrich] Tier 0 done: {changed} rows re-categorized")
    return changed


# ---------------------------------------------------------------------------
# Tier 1: Teeka4 direct INCI scrape
# ---------------------------------------------------------------------------
try:
    from bs4 import BeautifulSoup
    BS4_AVAILABLE = True
except ImportError:
    BS4_AVAILABLE = False


def _teeka4_panel(soup):
    for sel in ("#acctab-description", "#tab-description"):
        el = soup.select_one(sel)
        if el is not None:
            return el
    for el in soup.find_all(role="tabpanel"):
        if "description" in (el.get("aria-labelledby") or ""):
            return el
    return None


def scrape_teeka4_inci(url):
    try:
        resp = requests.get(url, headers={"User-Agent": UA}, timeout=15)
        if not resp.ok:
            return None
        resp.encoding = resp.apparent_encoding or "utf-8"
        text = None
        if BS4_AVAILABLE:
            soup = BeautifulSoup(resp.text, "html.parser")
            panel = _teeka4_panel(soup)
            if panel is not None:
                text = re.sub(r"\s+", " ", panel.get_text(" ", strip=True))
        if not text:
            text = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", resp.text)))
        text = text.replace("\u200b", "").replace("\ufeff", "")
        m = re.search(r"full\s+ingredients|ingredients\s*:", text, re.I)
        if not m:
            m = re.search(r"(?<![a-z]\s)ingredients", text, re.I)
        if not m:
            return None
        chunk = text[m.end():]
        cut = re.search(r"how\s+to\s+use|usage", chunk, re.I)
        if cut:
            chunk = chunk[:cut.start()]
        chunk = chunk[:1000]
        parts = [p.strip(" \t\u00a0;:") for p in chunk.split(",")]
        parts = [p for p in parts if p]
        merged = []
        for p in parts:
            if merged and (re.fullmatch(r"\d+", merged[-1])
                           or (merged[-1][-1].isdigit() and p[0].isdigit())):
                merged[-1] += "," + p
            else:
                merged.append(p)
        if len(merged) < 2:
            return None
        return merged
    except Exception:
        return None


def _enrich_teeka4_row(row, args, base_url, key):
    inci = scrape_teeka4_inci(row["product_url"])
    if not inci:
        log_row(row, "teeka4", "FAIL", "no INCI found on product page")
        return None
    row["raw_ingredients"] = inci
    if args.dry_run:
        log_row(row, "teeka4", "OK (dry-run)", f"{len(inci)} ingredients")
        return "enriched"
    status, err = patch_row(base_url, key, row["id"], {"raw_ingredients": inci})
    if status == "OK":
        log_row(row, "teeka4", "OK", f"{len(inci)} ingredients")
        return "enriched"
    if status == "COLUMN_MISSING":
        log_row(row, "teeka4", "FAIL", "raw_ingredients column missing")
        print(_MIGRATION_MESSAGE)
        return "column_missing"
    log_row(row, "teeka4", "FAIL", err)
    return None


def run_tier1(rows, args, base_url, key, workers=5):
    candidates = [r for r in rows
                  if str(r.get("source_shop") or "").lower() == TEEKA4
                  and _is_face(r)
                  and not r.get("raw_ingredients")
                  and r.get("product_url")]
    if args.limit:
        candidates = candidates[:args.limit]
    if not candidates:
        print("[Enrich] Tier 1 (teeka4): no candidate rows.")
        return 0
    print(f"[Enrich] Tier 1 (teeka4): scraping INCI for {len(candidates)} rows "
          f"with {workers} worker(s)")
    enriched = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(_enrich_teeka4_row, row, args, base_url, key)
                   for row in candidates]
        for fut in as_completed(futures):
            result = fut.result()
            if result == "enriched":
                enriched += 1
            elif result == "column_missing":
                for f in futures:
                    f.cancel()
                return enriched
            time.sleep(random.uniform(0.02, 0.08))
    print(f"[Enrich] Tier 1 (teeka4) done: {enriched} rows enriched")
    return enriched


# ---------------------------------------------------------------------------
# Tier 2: Gemini INCI lookup
# ---------------------------------------------------------------------------
def run_tier2(rows, args, base_url, key, client, stats):
    candidates = [r for r in rows if _is_face(r) and not r.get("raw_ingredients")]
    if args.limit:
        candidates = candidates[:args.limit]
    if not candidates:
        print("[Enrich] Tier 2 (gemini): no candidate rows.")
        return 0
    print(f"[Enrich] Tier 2 (gemini): INCI lookup for {len(candidates)} rows")
    enriched = 0
    for row in candidates:
        if client.exhausted:
            print("[Enrich] Tier 2 (gemini): stopping early - Gemini quota exhausted.")
            break
        inci = gemini_inci(client, row)
        if not inci:
            stats["gemini_not_found"] += 1
            log_row(row, "gemini", "FAIL", "known:false / unknown")
            time.sleep(random.uniform(0.4, 0.8))
            continue
        row["raw_ingredients"] = inci
        if args.dry_run:
            enriched += 1
            log_row(row, "gemini", "OK (dry-run)", f"{len(inci)} ingredients")
            time.sleep(random.uniform(0.4, 0.8))
            continue
        status, err = patch_row(base_url, key, row["id"], {"raw_ingredients": inci})
        if status == "OK":
            enriched += 1
            log_row(row, "gemini", "OK", f"{len(inci)} ingredients")
        elif status == "COLUMN_MISSING":
            log_row(row, "gemini", "FAIL", "raw_ingredients column missing")
            print(_MIGRATION_MESSAGE)
            return enriched
        else:
            log_row(row, "gemini", "FAIL", err)
        time.sleep(random.uniform(0.4, 0.8))
    print(f"[Enrich] Tier 2 (gemini) done: {enriched} enriched, {stats['gemini_not_found']} unknown")
    return enriched


# ---------------------------------------------------------------------------
# Tier 3: INCIDecoder brand-slug crawler fallback
# ---------------------------------------------------------------------------
class IncidecoderTier:
    def __init__(self, scraper, brands_slugs):
        self.scraper = scraper
        self.brands_slugs = brands_slugs
        self.cache = {}

    def brand_slug_key(self, brand):
        b = _norm(brand)
        if not b:
            return None
        for slug_key in self.brands_slugs:
            k = _norm(slug_key)
            if b == k or b in k or k in b:
                return slug_key
        return None

    def candidates_for(self, brand):
        if brand in self.cache:
            return self.cache[brand]
        slug = self.brands_slugs.get(brand)
        if not slug:
            self.cache[brand] = []
            return []
        results = []
        try:
            urls = self.scraper.scrape_brand_products(brand,
                max_products=INCIDECODER_MAX_PRODUCTS_PER_BRAND)
        except Exception as e:
            print(f"[Enrich] Tier 3: scrape_brand_products failed for {brand}: {e}")
            self.cache[brand] = []
            return []
        for u in urls:
            try:
                d = self.scraper.parse_product_page(u)
            except Exception as e:
                print(f"[Enrich] Tier 3: parse_product_page failed for {u}: {e}")
                d = None
            if d and d.get("Full Ingredient List"):
                ingredients = [x.strip() for x in d["Full Ingredient List"].split(",") if x.strip()]
                results.append({"name": d.get("Product Name") or "", "ingredients": ingredients})
            time.sleep(random.uniform(*INCIDECODER_DELAY))
        self.cache[brand] = results
        return results

    def best_match(self, name, candidates):
        best, best_score = None, 0.0
        for c in candidates:
            score = name_similarity(name, c["name"])
            if score > best_score:
                best, best_score = c, score
        if best and best_score >= NAME_MATCH_THRESHOLD:
            return best
        return None


def _enrich_incidecoder_brand(brand, rows_for_brand, args, base_url, key, inc_tier, stats):
    enriched = 0
    try:
        candidates_list = inc_tier.candidates_for(brand)
    except Exception as e:
        print(f"[Enrich] Tier 3 (incidecoder): candidates_for failed for {brand}: {e}", flush=True)
        return 0
    if not candidates_list:
        print(f"[Enrich] Tier 3 (incidecoder): no INCIDecoder candidates for {brand}", flush=True)
        return 0
    print(f"[Enrich] Tier 3 (incidecoder): {len(candidates_list)} INCIDecoder candidates "
          f"for {brand}", flush=True)
    for row in rows_for_brand:
        match = inc_tier.best_match(row.get("product_name"), candidates_list)
        if not match:
            with _STATS_LOCK:
                stats["incidecoder_no_match"] += 1
            log_row(row, "incidecoder", "FAIL", "no name match >= 0.75")
            continue
        inci = match["ingredients"]
        row["raw_ingredients"] = inci
        if args.dry_run:
            enriched += 1
            log_row(row, "incidecoder", "OK (dry-run)",
                    f"matched '{match['name'][:40]}' ({len(inci)} ingredients)")
            continue
        status, err = patch_row(base_url, key, row["id"], {"raw_ingredients": inci})
        if status == "OK":
            enriched += 1
            log_row(row, "incidecoder", "OK",
                    f"matched '{match['name'][:40]}' ({len(inci)} ingredients)")
        elif status == "COLUMN_MISSING":
            log_row(row, "incidecoder", "FAIL", "raw_ingredients column missing")
            print(_MIGRATION_MESSAGE)
            return -1
        else:
            log_row(row, "incidecoder", "FAIL", err)
    return enriched


def run_tier3(rows, args, base_url, key, inc_tier, stats, workers=3):
    candidates = [r for r in rows
                  if _is_face(r)
                  and not r.get("raw_ingredients")
                  and inc_tier.brand_slug_key(r.get("brand")) is not None]
    if args.limit:
        candidates = candidates[:args.limit]
    if not candidates:
        print("[Enrich] Tier 3 (incidecoder): no candidate rows.")
        return 0
    by_brand = defaultdict(list)
    for r in candidates:
        by_brand[inc_tier.brand_slug_key(r.get("brand"))].append(r)
    print(f"[Enrich] Tier 3 (incidecoder): crawling {len(by_brand)} brand(s) for "
          f"{len(candidates)} rows with {workers} worker(s)")
    enriched = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(_enrich_incidecoder_brand, brand, rows_for_brand, args,
                        base_url, key, inc_tier, stats): brand
            for brand, rows_for_brand in by_brand.items()
        }
        for fut in as_completed(futures):
            result = fut.result()
            if result == -1:
                for f in futures:
                    f.cancel()
                return enriched
            enriched += result
    print(f"[Enrich] Tier 3 (incidecoder) done: {enriched} rows enriched")
    return enriched


# ---------------------------------------------------------------------------
# Tier 4: og:image scrape
# ---------------------------------------------------------------------------
def fetch_og_image(url):
    try:
        resp = requests.get(url, headers={"User-Agent": UA}, timeout=15)
        if not resp.ok:
            return None
        m = (re.search(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
                       resp.text, re.I)
             or re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']',
                          resp.text, re.I))
        return m.group(1).strip() if m and m.group(1).strip() else None
    except Exception:
        return None


def _enrich_image_row(row, args, base_url, key, stats):
    img = fetch_og_image(row["product_url"])
    if not img:
        with _STATS_LOCK:
            stats["images_failed"] += 1
        log_row(row, "images", "FAIL", "no og:image")
        return None
    row["image_url"] = img
    if args.dry_run:
        log_row(row, "images", "OK (dry-run)", f"image -> {img[:60]}")
        return "updated"
    status, err = patch_row(base_url, key, row["id"], {"image_url": img})
    if status == "OK":
        log_row(row, "images", "OK", f"image -> {img[:60]}")
        return "updated"
    if status == "COLUMN_MISSING":
        log_row(row, "images", "FAIL", "image_url column missing")
        print(_MIGRATION_MESSAGE)
        return "column_missing"
    log_row(row, "images", "FAIL", err)
    return None


def run_tier4(rows, args, base_url, key, stats, workers=5):
    candidates = [r for r in rows
                  if _is_face(r) and not r.get("image_url") and r.get("product_url")]
    if args.limit:
        candidates = candidates[:args.limit]
    if not candidates:
        print("[Enrich] Tier 4 (images): no candidate rows.")
        return 0
    print(f"[Enrich] Tier 4 (images): scraping og:image for {len(candidates)} rows "
          f"with {workers} worker(s)")
    updated = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(_enrich_image_row, row, args, base_url, key, stats)
                   for row in candidates]
        for fut in as_completed(futures):
            result = fut.result()
            if result == "updated":
                updated += 1
            elif result == "column_missing":
                for f in futures:
                    f.cancel()
                return updated
            time.sleep(random.uniform(0.02, 0.08))
    print(f"[Enrich] Tier 4 (images) done: {updated} rows updated")
    return updated


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
TIER_ALIASES = {
    "tier0": "tier0", "recategorize": "tier0", "classify": "tier0",
    "tier1": "tier1", "teeka4": "tier1",
    "tier2": "tier2", "gemini": "tier2",
    "tier3": "tier3", "incidecoder": "tier3",
    "tier4": "tier4", "images": "tier4", "image": "tier4",
}


def parse_args():
    parser = argparse.ArgumentParser(
        description="Enrich nigerian_prices with raw_ingredients + image_url")
    parser.add_argument("--limit", type=int, default=None,
                        help="cap rows processed PER TIER (for smoke testing)")
    parser.add_argument("--tier", type=str, default=None,
                        help="run only one tier: tier0|teeka4|gemini|incidecoder|images")
    parser.add_argument("--dry-run", action="store_true",
                        help="fetch/parse but skip database writes")
    parser.add_argument("--workers", type=int, default=5,
                        help="parallel workers per tier (default: 5)")
    return parser.parse_args()


def main():
    args = parse_args()
    tier = TIER_ALIASES.get((args.tier or "").lower())
    if args.tier and not tier:
        print(f"[Enrich] FATAL: unknown --tier '{args.tier}' (use one of: "
              f"tier0, teeka4, gemini, incidecoder, images)")
        return 1

    env = {}
    env_path = None
    for candidate in (os.path.join(REPO_ROOT, "awa-skin", ".env.local"),
                      os.path.join(REPO_ROOT, ".env.local")):
        loaded = load_env_file(candidate)
        if loaded:
            env, env_path = loaded, candidate
            break
    for k, v in env.items():
        os.environ.setdefault(k, v)

    base_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    api_keys = [k.strip() for k in os.environ.get("GEMINI_API_KEYS", "").split(",") if k.strip()]
    if not base_url or not service_key:
        print("[Enrich] FATAL: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY "
              "not found in env")
        return 1
    if not api_keys:
        print("[Enrich] FATAL: GEMINI_API_KEYS not found in env")
        return 1

    print(f"[Enrich] env loaded from {env_path}")
    print(f"[Enrich] {len(api_keys)} Gemini key(s); dry_run={args.dry_run}; "
          f"limit={args.limit}; tier={tier or 'all'}")

    t_start = time.time()
    print("[Enrich] fetching all nigerian_prices rows (paginated, 1000/page)...")
    rows = fetch_all_rows(base_url, service_key)
    print(f"[Enrich] fetched {len(rows)} rows in {time.time() - t_start:.1f}s")

    stats = defaultdict(int)
    client = GeminiClient(api_keys)
    classify_batch = None

    inc_tier = None
    if not tier or tier == "tier3":
        try:
            from scrapers.incidecoder import INCIDecoderScraper, BRANDS_SLUGS
            inc_tier = IncidecoderTier(INCIDecoderScraper(use_selenium=False,
                                                          delay_range=INCIDECODER_DELAY),
                                       BRANDS_SLUGS)
        except Exception as e:
            print(f"[Enrich] Tier 3: INCIDecoder scraper unavailable ({e}); tier skipped.")

    tier_order = ["tier0", "tier1", "tier2", "tier3", "tier4"] if not tier else [tier]

    for t in tier_order:
        if MIGRATION_MISSING["flag"]:
            break
        if t == "tier0":
            if classify_batch is None:
                classify_batch = get_classify_batch(client)
            stats["tier0"] = run_tier0(rows, args, base_url, service_key, client, classify_batch)
        elif t == "tier1":
            stats["teeka4"] = run_tier1(rows, args, base_url, service_key,
                                        workers=args.workers)
        elif t == "tier2":
            stats["gemini"] = run_tier2(rows, args, base_url, service_key, client, stats)
        elif t == "tier3":
            if inc_tier is None:
                print("[Enrich] Tier 3 (incidecoder): skipped - scraper unavailable.")
            else:
                stats["incidecoder"] = run_tier3(rows, args, base_url, service_key,
                                                 inc_tier, stats, workers=args.workers)
        elif t == "tier4":
            stats["images"] = run_tier4(rows, args, base_url, service_key, stats,
                                        workers=args.workers)

    face_rows = [r for r in rows if _is_face(r)]
    still_missing = [r for r in face_rows if not r.get("raw_ingredients")]

    print("\n=== Enrichment Summary ===")
    print(f"Rows fetched:                 {len(rows)}")
    print(f"Face rows (post Tier 0):      {len(face_rows)}")
    print(f"Tier 0 re-categorized:        {stats.get('tier0', 0)}")
    print(f"Teeka4 INCI enriched:         {stats.get('teeka4', 0)}")
    print(f"Gemini INCI enriched:         {stats.get('gemini', 0)}")
    print(f"Gemini unknown (known:false): {stats.get('gemini_not_found', 0)}")
    print(f"INCIDecoder enriched:         {stats.get('incidecoder', 0)}")
    print(f"INCIDecoder no match:         {stats.get('incidecoder_no_match', 0)}")
    print(f"Images updated:               {stats.get('images', 0)}")
    print(f"Images failed:                {stats.get('images_failed', 0)}")
    print(f"Face rows still price-only:   {len(still_missing)}")
    print(f"Time elapsed:                 {time.time() - t_start:.1f}s")
    if MIGRATION_MISSING["flag"]:
        print(_MIGRATION_MESSAGE)
        print("[Enrich] Run aborted because the enrichment columns do not exist yet.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
