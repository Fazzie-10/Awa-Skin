import requests
import json
import time
import random
import os

def append_to_jsonl(filepath, data):
    """Appends a single dictionary as a JSON line to the target filepath."""
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, "a", encoding="utf-8") as f:
        f.write(json.dumps(data, ensure_ascii=False) + "\n")

class ShopifyScraper:
    def __init__(self, name, base_url, delay_range=(1.5, 3.5)):
        self.name = name
        self.base_url = base_url.rstrip('/')
        self.delay_range = delay_range
    
    def get_headers(self):
        return {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json",
        }
    
    def scrape_shop(self, max_pages=50, max_products=None, raw_filepath="data/raw_prices.jsonl"):
        """
        Scrapes a Shopify store's entire product catalog via the JSON API.
        Saves each product progressively to a JSON Lines file.
        """
        products_list = []
        page = 1
        
        print(f"\n[{self.name}] Starting Shopify scraper for {self.base_url} (Max Pages: {max_pages})")
        
        while page <= max_pages:
            url = f"{self.base_url}/products.json?page={page}&limit=250"
            
            print(f"[{self.name}] Fetching Page {page}: {url}")
            try:
                response = requests.get(url, headers=self.get_headers(), timeout=15)
                
                if response.status_code != 200:
                    print(f"[{self.name}] Page {page} returned status {response.status_code}. Stopping pagination.")
                    break
                
                data = response.json()
                products = data.get('products', [])
                
                if not products:
                    print(f"[{self.name}] No products found on page {page}. Stopping pagination.")
                    break
                
                print(f"[{self.name}] Found {len(products)} products on page {page}.")
                
                for product in products:
                    title = product.get('title', 'Unknown Product').strip()
                    brand = product.get('vendor', 'Generic/Unlisted').strip()
                    product_type = product.get('product_type', '').strip()
                    tags = product.get('tags', '').strip() if isinstance(product.get('tags', ''), str) else ','.join(product.get('tags', []))
                    handle = product.get('handle', '')
                    product_url = f"{self.base_url}/products/{handle}"
                    
                    # Get price from first variant
                    variants = product.get('variants', [])
                    price = None
                    if variants:
                        price_str = variants[0].get('price', '')
                        try:
                            price = int(float(price_str)) if price_str else None
                        except (ValueError, TypeError):
                            price = None
                    
                    # Build categories list from product_type and tags
                    categories = []
                    if product_type:
                        categories.append(product_type.lower().replace(' ', '-'))
                    if tags:
                        categories.extend([t.strip().lower().replace(' ', '-') for t in tags.split(',') if t.strip()])
                    
                    product_data = {
                        "Product Name": title,
                        "Brand": brand if brand else "Generic/Unlisted",
                        "Price (Naira)": price,
                        "Product URL": product_url,
                        "Source Shop": self.name,
                        "Categories": categories
                    }
                    
                    # Persist immediately to JSON Lines
                    append_to_jsonl(raw_filepath, product_data)
                    products_list.append(product_data)
                    
                    if max_products and len(products_list) >= max_products:
                        print(f"[{self.name}] Reached max limit of {max_products} products.")
                        return products_list
                
                delay = random.uniform(*self.delay_range)
                time.sleep(delay)
                page += 1
                
            except Exception as e:
                print(f"[{self.name}] Error scraping page {page}: {e}")
                break
        
        print(f"[{self.name}] Scraping complete. Total products extracted: {len(products_list)}")
        return products_list
