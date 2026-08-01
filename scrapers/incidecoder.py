import requests
from bs4 import BeautifulSoup
import time
import random
import re
import urllib.parse
import json
import os
from fake_useragent import UserAgent

# Selenium imports for fallback
try:
    from selenium import webdriver
    from selenium.webdriver.chrome.service import Service
    from webdriver_manager.chrome import ChromeDriverManager
    from selenium.webdriver.chrome.options import Options
    SELENIUM_AVAILABLE = True
except ImportError:
    SELENIUM_AVAILABLE = False

BRANDS_SLUGS = {
    "COSRX": "cosrx",
    "Beauty of Joseon": "beauty-of-joseon",
    "Anua": "anua",
    "Purito": "purito",
    "Isntree": "isntree",
    "Skin1004": "skin1004",
    "I'm From": "im-from",
    "Dear Klairs": "dear-klairs",
    "Round Lab": "round-lab",
    "Laneige": "laneige",
    "Etude House": "etude",
    "Sulwhasoo": "sulwhasoo",
    "Missha": "missha",
    "Neogen": "neogen",
    "Pyunkang Yul": "pyunkang-yul",
    "Torriden": "torriden",
    "Axis-Y": "axis-y",
    "Haruharu Wonder": "haruharu",
    "Numbuzin": "numbuzin",
    "Dr. Jart+": "dr-jart",
    "Belif": "belif",
    "TonyMoly": "tonymoly",
    "Mediheal": "mediheal",
    "Nature Republic": "nature-republic",
    "Banila Co": "banila-co",
    "The Face Shop": "the-face-shop",
    "Skinfood": "skinfood",
    "Amorepacific": "amorepacific",
    "Abib": "abib",
    "Mary & May": "mary-may",
    "Benton": "benton",
    "Jumiso": "jumiso",
    "Rovectin": "rovectin",
    "Celimax": "celimax",
    "Manyo Factory": "manyo",
    "One Thing": "one-thing",
    "TIAM": "tiam",
    "VT Cosmetics": "vt-cosmetics",
    "iUNIK": "iunik",
    "d'Alba": "d-alba",
    "Heimish": "heimish",
    "Goodal": "goodal",
    "Thank You Farmer": "thank-you-farmer",
    "Tocobo": "tocobo",
    "Mixsoon": "mixsoon",
    "Some By Mi": "some-by-mi",
    "Innisfree": "innisfree",
    "Aestura": "aestura",
    "Beplain": "beplain",
    "Illiyoon": "illiyoon",
    "CeraVe": "cerave",
    "Paula's Choice": "paulas-choice",
    "The Ordinary": "the-ordinary"
}

def append_to_jsonl(filepath, data):
    """
    Appends a single dictionary as a JSON line to the target filepath.
    """
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, "a", encoding="utf-8") as f:
        f.write(json.dumps(data, ensure_ascii=False) + "\n")

class INCIDecoderScraper:
    def __init__(self, use_selenium=False, delay_range=(1.5, 3.5)):
        self.base_url = "https://incidecoder.com"
        self.use_selenium = use_selenium
        self.delay_range = delay_range
        self.driver = None
        
        try:
            self.ua = UserAgent()
        except Exception:
            self.ua = None

        if self.use_selenium:
            self.init_selenium()

    def init_selenium(self):
        if not SELENIUM_AVAILABLE:
            print("[INCIDecoder] Selenium is not installed or import failed. Using requests only.")
            self.use_selenium = False
            return
        
        try:
            print("[INCIDecoder] Initializing Headless Chrome Driver...")
            options = Options()
            options.add_argument("--headless")
            options.add_argument("--disable-gpu")
            options.add_argument("--no-sandbox")
            options.add_argument("--disable-dev-shm-usage")
            options.add_argument("--window-size=1920,1080")
            ua_string = self.ua.random if self.ua else "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            options.add_argument(f"user-agent={ua_string}")
            
            service = Service(ChromeDriverManager().install())
            self.driver = webdriver.Chrome(service=service, options=options)
            print("[INCIDecoder] Chrome driver initialized successfully.")
        except Exception as e:
            print(f"[INCIDecoder] Failed to initialize Selenium: {e}. Falling back to requests.")
            self.use_selenium = False
            self.driver = None

    def get_headers(self):
        user_agent = self.ua.random if self.ua else "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        return {
            "User-Agent": user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            "Referer": self.base_url
        }

    def get_html(self, url):
        headers = self.get_headers()
        
        if self.use_selenium and self.driver:
            try:
                self.driver.get(url)
                time.sleep(2)
                title = self.driver.title.lower()
                if "just a moment" in title or "attention required" in title or "cloudflare" in title:
                    print(f"[INCIDecoder] Cloudflare wall detected in Selenium for {url}. Waiting longer...")
                    time.sleep(5)
                return self.driver.page_source, 200
            except Exception as e:
                print(f"[INCIDecoder] Selenium error: {e}. Trying requests fallback.")
        
        try:
            response = requests.get(url, headers=headers, timeout=15)
            if response.status_code in [403, 429, 503] and SELENIUM_AVAILABLE and not self.driver:
                print(f"[INCIDecoder] Requests got status {response.status_code}. Spawning Selenium driver to bypass...")
                self.use_selenium = True
                self.init_selenium()
                if self.driver:
                    return self.get_html(url)
            return response.text, response.status_code
        except Exception as e:
            print(f"[INCIDecoder] Requests error for {url}: {e}")
            return None, 500

    def scrape_brand_products(self, brand_name, max_products=None):
        slug = BRANDS_SLUGS.get(brand_name)
        if not slug:
            print(f"[INCIDecoder] Brand name '{brand_name}' not found in mappings!")
            return []

        product_urls = []
        offset = 0
        
        print(f"[INCIDecoder] Crawling product list for {brand_name} (slug: {slug})")
        
        while True:
            url = f"{self.base_url}/brands/{slug}?offset={offset}"
            print(f"[INCIDecoder] Crawling list page: {url}")
            
            html, status = self.get_html(url)
            if status != 200 or not html:
                print(f"[INCIDecoder] Could not access list page. Status: {status}")
                break
                
            soup = BeautifulSoup(html, "html.parser")
            
            links = soup.find_all("a", href=True)
            page_urls = []
            for l in links:
                href = l["href"]
                if href.startswith("/products/") and not href.endswith("/products"):
                    abs_url = urllib.parse.urljoin(self.base_url, href)
                    if abs_url not in product_urls and abs_url not in page_urls:
                        page_urls.append(abs_url)
            
            if not page_urls:
                print("[INCIDecoder] No products found on this page. Pagination ended.")
                break
                
            product_urls.extend(page_urls)
            print(f"[INCIDecoder] Found {len(page_urls)} products on page. Total so far: {len(product_urls)}")
            
            if max_products and len(product_urls) >= max_products:
                product_urls = product_urls[:max_products]
                print(f"[INCIDecoder] Reached brand product limit: {max_products}")
                break
                
            next_page = soup.find("a", string=re.compile(r"Next page", re.IGNORECASE))
            if not next_page:
                next_offset_url = f"/brands/{slug}?offset={offset + 1}"
                next_page = soup.find("a", href=lambda x: x and next_offset_url in x)
                
            if not next_page:
                print("[INCIDecoder] No 'Next page' element found. Pagination ended.")
                break
                
            offset += 1
            time.sleep(random.uniform(*self.delay_range))
            
        return product_urls

    def parse_product_page(self, product_url):
        print(f"[INCIDecoder] Parsing product page: {product_url}")
        html, status = self.get_html(product_url)
        if status != 200 or not html:
            print(f"[INCIDecoder] Failed to fetch product page. Status: {status}")
            return None
            
        soup = BeautifulSoup(html, "html.parser")
        
        h1 = soup.find("h1")
        if not h1:
            print("[INCIDecoder] H1 title not found on page!")
            return None
            
        brand = "Unknown Brand"
        h1_a = h1.find("a")
        if h1_a:
            brand = h1_a.text.strip()
            product_name = h1.text.replace(h1_a.text, "").replace("\n", " ").strip()
        else:
            h1_text = " ".join(h1.text.split())
            product_name = h1_text
            
        product_name = " ".join(product_name.split())
        
        table = soup.find("table", class_="product-skim")
        if not table:
            print(f"[INCIDecoder] Ingredients table (.product-skim) not found for {product_name}!")
            return None
            
        rows = table.find_all("tr")
        
        ingredients_list = []
        soothing = []
        antioxidant = []
        exfoliant = []
        cell_communicating = []
        brightening = []
        moisturizing = []
        
        for row in rows[1:]:
            cells = row.find_all(["td", "th"])
            if len(cells) < 2:
                continue
                
            ing_tag = cells[0].find("a")
            ing_name = ing_tag.text.strip() if ing_tag else cells[0].text.strip()
            ing_name = ing_name.replace('\u200b', '').strip()
            ingredients_list.append(ing_name)
            
            func_tags = cells[1].find_all("a")
            funcs = [f.text.strip().lower().replace('\u200b', '') for f in func_tags]
            
            for f in funcs:
                if "soothing" in f:
                    soothing.append(ing_name)
                if "antioxidant" in f:
                    antioxidant.append(ing_name)
                if "exfoliant" in f:
                    exfoliant.append(ing_name)
                if "cell-communicating" in f:
                    cell_communicating.append(ing_name)
                if "brightening" in f:
                    brightening.append(ing_name)
                if "moisturizer" in f or "humectant" in f:
                    moisturizing.append(ing_name)
                    
        full_ingredients_str = ", ".join(ingredients_list)
        
        return {
            "Product Name": product_name,
            "Brand": brand,
            "Full Ingredient List": full_ingredients_str,
            "Soothing Ingredients": ", ".join(soothing) if soothing else "None",
            "Antioxidant Ingredients": ", ".join(antioxidant) if antioxidant else "None",
            "Exfoliant Ingredients": ", ".join(exfoliant) if exfoliant else "None",
            "Cell-Communicating Ingredients": ", ".join(cell_communicating) if cell_communicating else "None",
            "Brightening Ingredients": ", ".join(brightening) if brightening else "None",
            "Moisturizing Ingredients": ", ".join(moisturizing) if moisturizing else "None",
            "Product URL": product_url
        }

    def scrape_brands(self, brand_names, max_products_per_brand=5, raw_filepath="data/raw_ingredients.jsonl"):
        """
        Orchestrates scraping of multiple brands.
        Saves each product progressively to a JSON Lines file.
        Skips already scraped URLs to speed up execution and avoid duplicate requests.
        """
        existing_urls = set()
        if os.path.exists(raw_filepath):
            try:
                with open(raw_filepath, "r", encoding="utf-8") as f:
                    for line in f:
                        if line.strip():
                            data = json.loads(line)
                            # Key might be "Product URL" or "product_url"
                            url = data.get("Product URL") or data.get("product_url")
                            if url:
                                existing_urls.add(url)
            except Exception as e:
                print(f"[INCIDecoder] Error loading existing URLs: {e}")
                
        print(f"[INCIDecoder] Loaded {len(existing_urls)} existing product URLs. They will be skipped.")

        all_products = []
        for name in brand_names:
            print(f"\n[INCIDecoder] Scraper running for brand: {name}")
            urls = self.scrape_brand_products(name, max_products=max_products_per_brand)
            
            for url in urls:
                if url in existing_urls:
                    print(f"[INCIDecoder] Skipping already scraped product: {url}")
                    continue
                    
                prod_data = self.parse_product_page(url)
                if prod_data:
                    # Persist immediately
                    append_to_jsonl(raw_filepath, prod_data)
                    all_products.append(prod_data)
                    
                time.sleep(random.uniform(*self.delay_range))
                
        return all_products

    def close(self):
        if self.driver:
            print("[INCIDecoder] Closing Selenium Chrome Driver...")
            try:
                self.driver.quit()
            except Exception:
                pass
