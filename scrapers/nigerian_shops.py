import requests
from bs4 import BeautifulSoup
import re
import time
import random
from fake_useragent import UserAgent
import urllib.parse
import json
import os

# List of target brands to help auto-infer brand from product titles
KNOWN_BRANDS = [
    "COSRX", "Beauty of Joseon", "Anua", "Purito", "Isntree", "Skin1004", 
    "I'm From", "Dear Klairs", "Klairs", "Round Lab", "Laneige", "Etude House", "Etude",
    "Sulwhasoo", "Missha", "Neogen", "Pyunkang Yul", "Torriden", "Axis-Y", 
    "Haruharu Wonder", "Haruharu", "Numbuzin", "Dr. Jart+", "Dr. Jart", "Belif", 
    "TonyMoly", "Mediheal", "Nature Republic", "Banila Co", "The Face Shop", 
    "Skinfood", "Amorepacific", "Abib", "Mary & May", "Benton", "Jumiso", 
    "Rovectin", "Celimax", "Manyo Factory", "Manyo", "One Thing", "TIAM", 
    "VT Cosmetics", "VT", "iUNIK", "d'Alba", "Heimish", "Goodal", 
    "Thank You Farmer", "Tocobo", "Mixsoon", "Some By Mi", "Innisfree", 
    "Aestura", "Beplain", "Illiyoon", "CeraVe", "Paula's Choice", "The Ordinary"
]

def clean_price(price_str):
    """
    Cleans e-commerce price strings:
    - Strips spaces, currency symbols (e.g. ₦, NGN), commas.
    - If double prices exist (e.g., sale price showing both old and sale price),
      extracts the active sale price (usually the second/last one).
    - Converts to float or int. Returns None if parsing fails.
    """
    if not price_str:
        return None
    
    # Replace non-breaking spaces and normalize
    price_str = price_str.replace('\xa0', ' ').strip()
    
    # Find all decimal/integer number patterns
    # Handles numbers like "13,200.00" or "73550"
    matches = re.findall(r'[\d,]+\.?\d*', price_str)
    if not matches:
        return None
    
    # WooCommerce sale markup shows two prices, e.g. "₦12,600.00 ₦11,340.00"
    # The last price is the active price
    active_price_str = matches[-1].replace(',', '')
    
    try:
        if '.' in active_price_str:
            val = float(active_price_str)
            if val.is_integer():
                return int(val)
            return val
        return int(active_price_str)
    except ValueError:
        return None

def infer_brand(title):
    """
    Tries to infer the brand from the product title based on KNOWN_BRANDS list.
    """
    if not title:
        return None
    
    title_upper = title.upper()
    for brand in KNOWN_BRANDS:
        pattern = r'\b' + re.escape(brand.upper()) + r'\b'
        if re.search(pattern, title_upper):
            # Normalize common names
            if brand in ["Klairs", "Dear Klairs"]:
                return "Dear Klairs"
            if brand in ["Etude", "Etude House"]:
                return "Etude House"
            if brand in ["Dr. Jart", "Dr. Jart+"]:
                return "Dr. Jart+"
            if brand in ["Manyo", "Manyo Factory"]:
                return "Manyo Factory"
            if brand in ["VT", "VT Cosmetics"]:
                return "VT Cosmetics"
            if brand in ["Haruharu", "Haruharu Wonder"]:
                return "Haruharu Wonder"
            return brand
            
    return None

def append_to_jsonl(filepath, data):
    """
    Appends a single dictionary as a JSON line to the target filepath.
    """
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, "a", encoding="utf-8") as f:
        f.write(json.dumps(data, ensure_ascii=False) + "\n")

class WooCommerceScraper:
    def __init__(self, name, base_url, delay_range=(1.0, 3.0)):
        self.name = name
        self.base_url = base_url.rstrip('/')
        self.delay_range = delay_range
        try:
            self.ua = UserAgent()
        except Exception:
            self.ua = None

    def get_headers(self):
        user_agent = self.ua.random if self.ua else "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        return {
            "User-Agent": user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            "Referer": self.base_url
        }

    def scrape_shop(self, max_pages=10, max_products=None, raw_filepath="data/raw_prices.jsonl", start_page=1):
        """
        Scrapes WooCommerce shop catalog paginated.
        Saves each product progressively to a JSON Lines file.
        """
        products_list = []
        page = start_page
        
        print(f"\n[{self.name}] Starting scraper for {self.base_url} (Max Pages: {max_pages})")
        
        while page <= max_pages:
            if page == 1:
                url = f"{self.base_url}/shop/"
            else:
                url = f"{self.base_url}/shop/page/{page}/"

            print(f"[{self.name}] Fetching Page {page}: {url}")
            response = None
            for attempt in range(3):
                try:
                    response = requests.get(url, headers=self.get_headers(), timeout=20)
                    break
                except (requests.exceptions.RequestException, Exception) as req_err:
                    print(f"[{self.name}] Request attempt {attempt+1}/3 failed: {req_err}")
                    if attempt < 2:
                        time.sleep(2)
            
            if response is None:
                print(f"[{self.name}] Failed to fetch page {page} after 3 attempts. Stopping pagination.")
                break

            try:
                if response.status_code == 404 and page > 1:
                    url_alt = f"{self.base_url}/shop/?paged={page}"
                    print(f"[{self.name}] Got 404, trying alternate pagination: {url_alt}")
                    response = requests.get(url_alt, headers=self.get_headers(), timeout=20)
                
                if response.status_code != 200:
                    print(f"[{self.name}] Page {page} returned status {response.status_code}. Stopping pagination.")
                    break
                
                if "maintenance" in response.url or "store closed" in response.text.lower():
                    print(f"[{self.name}] Detected maintenance or store closed message. Stopping.")
                    break
                
                soup = BeautifulSoup(response.text, "html.parser")
                items = soup.find_all("li", class_="product")
                
                if not items:
                    items = soup.find_all(class_=lambda x: x and ("product-grid" in x or "product-item" in x) and not "ul" in x)
                
                if not items:
                    print(f"[{self.name}] No product items found on Page {page}. Stopping pagination.")
                    break
                
                print(f"[{self.name}] Found {len(items)} products on page {page}.")
                
                page_products_added = 0
                for item in items:
                    link_tag = item.find("a", href=True)
                    if not link_tag:
                        continue
                    
                    product_url = urllib.parse.urljoin(self.base_url, link_tag["href"])
                    
                    # Extract WooCommerce categories from CSS classes
                    css_classes = item.get('class', [])
                    woo_categories = [c.replace('product_cat-', '') for c in css_classes if c.startswith('product_cat-')]
                    
                    title_tag = item.find(class_=lambda x: x and "title" in x.lower())
                    if not title_tag:
                        title_tag = item.find(["h2", "h3", "h4"])
                    
                    title = title_tag.text.strip() if title_tag else "Unknown Product"
                    # Clean bulk pricing text (e.g., "Buy 6pcs for NGN4,500 Each...")
                    import re
                    title = re.sub(r"Buy\s+\d+pcs\s+for\s+NGN[\d,]+\s+Each", "", title, flags=re.IGNORECASE).strip()
                    if not title:
                        title = "Unknown Product"
                    brand = infer_brand(title)
                    
                    if not brand:
                        brand_tag = item.find(class_=lambda x: x and any(term in x.lower() for term in ["brand", "vendor"]))
                        if brand_tag:
                            brand = brand_tag.text.strip()
                    
                    price_tag = item.find(class_=lambda x: x and "price" in x.lower())
                    raw_price = price_tag.text.strip() if price_tag else ""
                    cleaned_price = clean_price(raw_price)
                    
                    product_data = {
                        "Product Name": title,
                        "Brand": brand if brand else "Generic/Unlisted",
                        "Price (Naira)": cleaned_price,
                        "Product URL": product_url,
                        "Source Shop": self.name,
                        "Categories": woo_categories
                    }
                    
                    # Persist immediately to JSON Lines
                    append_to_jsonl(raw_filepath, product_data)
                    
                    products_list.append(product_data)
                    page_products_added += 1
                    
                    if max_products and len(products_list) >= max_products:
                        print(f"[{self.name}] Reached max limit of {max_products} products.")
                        return products_list
                
                if page_products_added == 0:
                    print(f"[{self.name}] No new valid products parsed from Page {page}. Stopping.")
                    break
                
                delay = random.uniform(*self.delay_range)
                time.sleep(delay)
                
                page += 1
                
            except Exception as e:
                print(f"[{self.name}] Error scraping page {page}: {e}")
                break
                
        print(f"[{self.name}] Scraping complete. Total products extracted: {len(products_list)}")
        return products_list
