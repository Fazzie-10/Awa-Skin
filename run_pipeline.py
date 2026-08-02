import os
import argparse
import pandas as pd
import json
from scrapers.nigerian_shops import WooCommerceScraper
from scrapers.shopify_scraper import ShopifyScraper
from scrapers.incidecoder import INCIDecoderScraper, BRANDS_SLUGS

RAW_PRICES_PATH = "data/raw_prices.jsonl"
RAW_INGREDIENTS_PATH = "data/raw_ingredients.jsonl"

def parse_args():
    parser = argparse.ArgumentParser(description="AI Esthetician Skincare Data Extraction Pipeline")
    
    # Scraper selectors
    parser.add_argument("--run-ingredients", action="store_true", help="Run Target 1: INCIDecoder ingredient scraper")
    parser.add_argument("--run-prices", action="store_true", help="Run Target 2: Nigerian e-commerce price scraper")
    parser.add_argument("--run-all", action="store_true", help="Run both scrapers")
    
    # Compile-only flag
    parser.add_argument("--compile-only", action="store_true", 
                        help="Skip crawling and only compile Excel/CSV spreadsheets from existing raw JSONL files")
    
    # Reset flag
    parser.add_argument("--reset-raw", action="store_true", 
                        help="Delete existing raw JSONL files before scraping to start fresh")
    
    # Config parameters for INCIDecoder
    parser.add_argument("--max-products-per-brand", type=int, default=5, 
                        help="Maximum number of products to scrape per brand on INCIDecoder (default: 5)")
    parser.add_argument("--use-selenium", action="store_true", 
                        help="Force headless Selenium Chrome driver for INCIDecoder (defaults to requests)")
    parser.add_argument("--brands", type=str, nargs="+", 
                        help="Specific brands to scrape on INCIDecoder (defaults to all 53 brands)")
    
    # Config parameters for Nigerian shops
    parser.add_argument("--max-pages-per-shop", type=int, default=3, 
                        help="Maximum pages to crawl per e-commerce shop (default: 3)")
    parser.add_argument("--max-products-per-shop", type=int, default=50, 
                        help="Maximum products to extract per e-commerce shop (default: 50)")
    parser.add_argument("--shops", type=str, nargs="+",
                        help="Specific shop names to scrape (e.g. --shops Teeka4). Defaults to all shops.")
    
    # Resume support for e-commerce scraping
    parser.add_argument("--start-page", type=int, default=1,
                        help="Page number to start scraping from for e-commerce shops (default: 1)")

    # Agentic categorization
    parser.add_argument("--run-agentic", action="store_true",
                        help="Run Gemini agentic categorization after scraping")
    parser.add_argument("--gemini-keys", type=str,
                        help="Comma-separated Gemini API keys (or set GEMINI_API_KEYS env var)")

    return parser.parse_args()

def compile_ingredients_data():
    if not os.path.exists(RAW_INGREDIENTS_PATH):
        print(f"[Compile] Raw ingredients file not found: {RAW_INGREDIENTS_PATH}")
        return None
        
    print(f"[Compile] Loading raw ingredient records from {RAW_INGREDIENTS_PATH}")
    records = []
    with open(RAW_INGREDIENTS_PATH, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                records.append(json.loads(line))
                
    if not records:
        return None
        
    df = pd.DataFrame(records)
    
    # Map to database-ready schema
    column_mapping = {
        "Product Name": "product_name",
        "Brand": "brand",
        "Full Ingredient List": "ingredients_list",
        "Soothing Ingredients": "soothing_ingredients",
        "Antioxidant Ingredients": "antioxidant_ingredients",
        "Exfoliant Ingredients": "exfoliant_ingredients",
        "Cell-Communicating Ingredients": "cell_communicating_ingredients",
        "Brightening Ingredients": "brightening_ingredients",
        "Moisturizing Ingredients": "moisturizing_ingredients",
        "Product URL": "product_url"
    }
    
    df = df.rename(columns=column_mapping)
    
    # Clean up empty or missing product names
    if "product_name" in df.columns:
        df["product_name"] = df["product_name"].fillna("").astype(str).str.strip()
        for idx, row in df.iterrows():
            if not row["product_name"]:
                # Use the last part of the product URL slug as a fallback
                slug = row["product_url"].rstrip('/').split('/')[-1]
                fallback_name = slug.replace('-', ' ').strip().title()
                if not fallback_name or fallback_name.lower() == row["brand"].lower():
                    df.at[idx, "product_name"] = row["brand"]
                else:
                    df.at[idx, "product_name"] = fallback_name
                    
    # De-duplicate by product URL to handle appends/resumes cleanly
    initial_len = len(df)
    df = df.drop_duplicates(subset=["product_url"])
    print(f"[Compile] Ingredients deduplicated: {initial_len} -> {len(df)} records")
    return df

def compile_prices_data():
    if not os.path.exists(RAW_PRICES_PATH):
        print(f"[Compile] Raw prices file not found: {RAW_PRICES_PATH}")
        return None
        
    print(f"[Compile] Loading raw pricing records from {RAW_PRICES_PATH}")
    records = []
    with open(RAW_PRICES_PATH, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                try:
                    records.append(json.loads(line))
                except Exception:
                    continue
                
    if not records:
        return None
        
    df = pd.DataFrame(records)
    
    # Map to database-ready schema
    column_mapping = {
        "Product Name": "product_name",
        "Brand": "brand",
        "Price (Naira)": "price_naira",
        "Product URL": "product_url",
        "Source Shop": "source_shop",
        "Categories": "categories",
    }
    
    df = df.rename(columns=column_mapping)
    
    # Filter to prioritize target shops
    target_shops = ["BuyBetter", "Teeka4", "BeautyByDaz", "SkinPopEssentiel", "PeronaBeauty_Lagos", "PeronaBeauty_Ibadan"]
    df = df[df["source_shop"].isin(target_shops)].copy()
    
    # Add location based on source shop
    shop_locations = {
        "BuyBetter": "Lagos",
        "Teeka4": "Lagos",
        "BeautyByDaz": "Lagos",
        "SkinPopEssentiel": "Abuja",
        "PeronaBeauty_Lagos": "Lagos",
        "PeronaBeauty_Ibadan": "Ibadan",
    }
    df["location"] = df["source_shop"].map(shop_locations).fillna("Unknown")
    
    # Sort by location and shop for clean grouping in tables
    df = df.sort_values(by=["location", "source_shop", "product_name"]).reset_index(drop=True)
    
    # De-duplicate by product URL to handle appends/resumes cleanly
    initial_len = len(df)
    df = df.drop_duplicates(subset=["product_url"])
    print(f"[Compile] Prices deduplicated: {initial_len} -> {len(df)} records")
    return df

def run_ingredients_pipeline(brands_to_run, max_products_per_brand, use_selenium):
    print("\n" + "="*50)
    print("STARTING TARGET 1: INGREDIENT ENGINE (INCIDECODER.COM)")
    print("="*50)
    
    scraper = INCIDecoderScraper(use_selenium=use_selenium)
    try:
        scraper.scrape_brands(
            brands_to_run, 
            max_products_per_brand=max_products_per_brand, 
            raw_filepath=RAW_INGREDIENTS_PATH
        )
    finally:
        scraper.close()

def run_prices_pipeline(max_pages, max_products_per_shop, shops_filter=None):
    print("\n" + "="*50)
    print("STARTING TARGET 2: PRICING & AVAILABILITY ENGINE (NIGERIAN E-COMMERCE)")
    print("="*50)
    
    all_shops = {
        "BuyBetter":          {"url": "https://buybetter.ng",           "platform": "woocommerce", "location": "Lagos"},
        "Teeka4":             {"url": "https://teeka4.com",             "platform": "woocommerce", "location": "Lagos"},
        "BeautyByDaz":        {"url": "https://beautybydaz.com",        "platform": "woocommerce", "location": "Lagos"},
        "SkinPopEssentiel":   {"url": "https://skinpopessentiel.com",   "platform": "shopify",     "location": "Abuja"},
        "PeronaBeauty_Lagos":  {"url": "https://peronabeauty.com",       "platform": "woocommerce", "location": "Lagos"},
        "PeronaBeauty_Ibadan": {"url": "https://ibadan.peronabeauty.com", "platform": "woocommerce", "location": "Ibadan"},
    }
    
    # Filter to specific shops if requested
    if shops_filter:
        shops = {k: v for k, v in all_shops.items() if k in shops_filter}
        if not shops:
            print(f"[Prices Pipeline] No matching shops found for filter: {shops_filter}")
            return
        print(f"[Prices Pipeline] Targeting {len(shops)} shop(s): {list(shops.keys())}")
    else:
        shops = all_shops
    
    for name, config in shops.items():
        if config["platform"] == "shopify":
            scraper = ShopifyScraper(name, config["url"])
        else:
            scraper = WooCommerceScraper(name, config["url"])
        
        try:
            scraper.scrape_shop(
                max_pages=max_pages, 
                max_products=max_products_per_shop, 
                raw_filepath=RAW_PRICES_PATH
            )
        except Exception as e:
            print(f"[Prices Pipeline] Error scraping {name}: {e}")

def save_dataframe(df, base_filename):
    os.makedirs("data", exist_ok=True)
    
    csv_path = f"data/{base_filename}.csv"
    excel_path = f"data/{base_filename}.xlsx"
    
    # Save CSV
    try:
        df.to_csv(csv_path, index=False, encoding="utf-8")
        print(f"[Export] Saved clean CSV: {csv_path} ({len(df)} records)")
    except PermissionError:
        print(f"\n[Warning] Permission Denied: Could not save CSV to {csv_path} because the file is locked (likely open in Excel or another program). Please close it.")
    except Exception as e:
        print(f"[Export] Failed to save CSV file: {e}")
    
    # Save Excel
    try:
        df.to_excel(excel_path, index=False, engine="openpyxl")
        print(f"[Export] Saved Excel sheet: {excel_path}")
    except PermissionError:
        print(f"\n[Warning] Permission Denied: Could not save Excel to {excel_path} because the file is locked (likely open in Excel or another program). Please close it.")
    except Exception as e:
        print(f"[Export] Failed to save Excel file: {e}")

def main():
    args = parse_args()
    
    # Option to clear previous raw cache files
    if args.reset_raw:
        print("[Reset] Deleting existing raw JSONL files...")
        if os.path.exists(RAW_PRICES_PATH):
            os.remove(RAW_PRICES_PATH)
            print(f"Deleted {RAW_PRICES_PATH}")
        if os.path.exists(RAW_INGREDIENTS_PATH):
            os.remove(RAW_INGREDIENTS_PATH)
            print(f"Deleted {RAW_INGREDIENTS_PATH}")

    if args.compile_only:
        print("\n" + "="*50)
        print("RUNNING COMPILE ONLY MODE")
        print("="*50)
        df_ing = compile_ingredients_data()
        if df_ing is not None:
            save_dataframe(df_ing, "ingredients_database")
            
        df_pri = compile_prices_data()
        if df_pri is not None:
            save_dataframe(df_pri, "nigerian_prices")
        return

    # Default to run both scrapers only if no specific action flag was passed
    any_action = args.run_ingredients or args.run_prices or args.run_all or args.compile_only or args.run_agentic
    run_ing = args.run_ingredients or args.run_all or not any_action
    run_pri = args.run_prices or args.run_all or not any_action
    
    if run_ing:
        if args.brands:
            brands_to_run = [b for b in args.brands if b in BRANDS_SLUGS]
            if not brands_to_run:
                print(f"Error: None of the brands specified {args.brands} exist in mappings.")
                return
        else:
            brands_to_run = list(BRANDS_SLUGS.keys())
            
        print(f"[Pipeline] Selected {len(brands_to_run)} brands for ingredient scraping.")
        
        run_ingredients_pipeline(
            brands_to_run=brands_to_run,
            max_products_per_brand=args.max_products_per_brand,
            use_selenium=args.use_selenium
        )
        
        # Compile at the end
        df_ing = compile_ingredients_data()
        if df_ing is not None:
            save_dataframe(df_ing, "ingredients_database")
            
    if run_pri:
        run_prices_pipeline(
            max_pages=args.max_pages_per_shop,
            max_products_per_shop=args.max_products_per_shop,
            shops_filter=args.shops if args.shops else None
        )
        
        # Compile at the end
        df_pri = compile_prices_data()
        if df_pri is not None:
            save_dataframe(df_pri, "nigerian_prices")

    if args.run_agentic:
        from scripts.agentic_categorize import run_agentic_cleaning
        keys = args.gemini_keys.split(",") if args.gemini_keys else None
        run_agentic_cleaning(
            input_csv="data/nigerian_prices.csv",
            output_csv="data/nigerian_prices_agentic.csv",
            api_keys=keys,
            shops_filter=args.shops if args.shops else None
        )

    # Auto-verification
    verify_pipeline_output()

def verify_pipeline_output():
    """Automatic verification of pipeline output data quality."""
    print("\n" + "="*50)
    print("RUNNING AUTO-VERIFICATION")
    print("="*50)
    
    issues = []
    
    # Check prices file
    if os.path.exists("data/nigerian_prices.csv"):
        df = pd.read_csv("data/nigerian_prices.csv")
        print(f"[Verify] Prices: {len(df)} total records")
        
        # Check for missing prices
        null_prices = df['price_naira'].isna().sum()
        if null_prices > 0:
            issues.append(f"WARNING: {null_prices} products have missing prices")
        
        # Check for missing product names
        null_names = df['product_name'].isna().sum()
        if null_names > 0:
            issues.append(f"WARNING: {null_names} products have missing names")
        
        # Check shop distribution
        print("[Verify] Shop distribution:")
        print(df['source_shop'].value_counts().to_string())
        
        # Check location distribution
        if 'location' in df.columns:
            print("[Verify] Location distribution:")
            print(df['location'].value_counts().to_string())
    else:
        issues.append("ERROR: data/nigerian_prices.csv not found")
    
    # Check agentic file if exists
    if os.path.exists("data/nigerian_prices_agentic.csv"):
        df_a = pd.read_csv("data/nigerian_prices_agentic.csv")
        print(f"\n[Verify] Agentic: {len(df_a)} categorized records")
        print(df_a['core_step'].value_counts().to_string())
    
    if issues:
        print("\n[Verify] Issues found:")
        for issue in issues:
            print(f"  - {issue}")
    else:
        print("\n[Verify] All checks passed!")
    
    return len(issues) == 0

if __name__ == "__main__":
    main()
