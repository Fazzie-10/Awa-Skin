import pandas as pd
import requests
import json
import time
import os

# API keys for rotation (to handle per-key daily limits)
API_KEYS = [k.strip() for k in os.environ.get("GEMINI_API_KEYS", "").split(",") if k.strip()]
if not API_KEYS:
    raise SystemExit("Missing GEMINI_API_KEYS environment variable")
current_key_index = 0

def get_api_url(model="gemini-3.5-flash"):
    global current_key_index
    key = API_KEYS[current_key_index % len(API_KEYS)]
    return f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"

def rotate_key():
    global current_key_index
    current_key_index += 1
    if current_key_index >= len(API_KEYS):
        print(f"[Agentic] All {len(API_KEYS)} API keys exhausted. Stopping.")
        return False
    print(f"[Agentic] Rotating to API key {current_key_index + 1}/{len(API_KEYS)}")
    return True

def classify_batch(products):
    """
    Sends a batch of products to Gemini for classification.
    Returns a dictionary mapping product name to a dict with 'core_step' and 'sub_category'.
    """
    prompt = """
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
    for p in products:
        prompt += f"- {p}\n"

    payload = {
        "contents": [{
            "parts": [{"text": prompt}]
        }],
        "generationConfig": {
            "temperature": 0.1,
            "response_mime_type": "application/json"
        }
    }
    
    headers = {"Content-Type": "application/json"}
    models = ["gemini-3.5-flash", "gemini-2.0-flash", "gemini-flash-latest"]
    
    for attempt in range(6):
        model = models[attempt % len(models)]
        try:
            url = get_api_url(model)
            response = requests.post(url, headers=headers, json=payload, timeout=30)
            
            if response.status_code in (429, 503):
                print(f"[Agentic] Got {response.status_code} on {model}. Rotating key...")
                if not rotate_key():
                    return None
                time.sleep(2)
                continue
                
            response.raise_for_status()
            
            data = response.json()
            if 'candidates' in data and len(data['candidates']) > 0:
                text = data['candidates'][0]['content']['parts'][0]['text']
                
                # Clean up potential markdown formatting if model still adds it
                text = text.strip()
                if text.startswith("```json"):
                    text = text[7:]
                if text.endswith("```"):
                    text = text[:-3]
                    
                json_results = json.loads(text.strip())
                
                # Map results to a dict for easy lookup
                result_map = {}
                for item in json_results:
                    result_map[item.get('product_name')] = {
                        'core_step': item.get('core_step', 'Uncategorized'),
                        'sub_category': item.get('sub_category', 'Unknown')
                    }
                return result_map
            else:
                print(f"Error on attempt {attempt+1}: No candidates returned from API.")
        except Exception as e:
            print(f"API Request Failed on attempt {attempt+1}: {e}")
            if attempt < 5:
                print("Retrying in 3 seconds...")
                time.sleep(3)
            
    return None

def main(input_csv="data/nigerian_prices.csv", output_csv="data/nigerian_prices_agentic.csv", shops_filter=None):
    input_file = input_csv
    output_file = output_csv
    
    df = pd.read_csv(input_file)
    if shops_filter:
        target_shops = shops_filter
        df_filtered = df[df['source_shop'].isin(target_shops)].copy()
    else:
        df_filtered = df.copy()
    
    print(f"Total products to process: {len(df_filtered)}")
    
    # Check if we already have partial progress
    processed_names = set()
    if os.path.exists(output_file):
        df_existing = pd.read_csv(output_file)
        processed_names = set(df_existing['product_name'].tolist())
        print(f"Found {len(processed_names)} already processed products. Resuming...")
    else:
        # Create empty file with headers
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write("product_name,brand,core_step,sub_category,price_naira,source_shop,product_url\n")
            
    # Filter out already processed
    df_todo = df_filtered[~df_filtered['product_name'].isin(processed_names)]
    print(f"Products remaining to process: {len(df_todo)}")
    
    if len(df_todo) == 0:
        print("All products processed!")
        return

    batch_size = 50
    products_to_process = df_todo.to_dict('records')
    total_batches = (len(products_to_process) + batch_size - 1) // batch_size
    
    for i in range(0, len(products_to_process), batch_size):
        batch = products_to_process[i:i+batch_size]
        batch_num = (i // batch_size) + 1
        
        print(f"\nProcessing Batch {batch_num}/{total_batches} ({len(batch)} products)...")
        
        product_names = [p['product_name'] for p in batch]
        
        results_map = classify_batch(product_names)
        
        if results_map is None:
            print(f"[Agentic] API limit reached for batch {batch_num}. Using keyword-based fallback for remaining products in batch...")
            from scripts.categorize_products import categorize_product
            results_map = {}
            for name in product_names:
                step, subcat = categorize_product(name)
                results_map[name] = {'core_step': step, 'sub_category': subcat}

        # Append to file
        with open(output_file, 'a', encoding='utf-8') as f:
            for row in batch:
                name = row['product_name']
                classification = results_map.get(name, {'core_step': 'Uncategorized', 'sub_category': 'Unknown'})
                
                # Clean strings for CSV
                clean_name = str(name).replace('"', '""')
                clean_brand = str(row['brand']).replace('"', '""')
                clean_shop = str(row['source_shop']).replace('"', '""')
                clean_url = str(row['product_url']).replace('"', '""')
                
                f.write(f'"{clean_name}","{clean_brand}","{classification["core_step"]}","{classification["sub_category"]}",{row["price_naira"]},"{clean_shop}","{clean_url}"\n')
        
        print(f"Batch {batch_num} saved successfully.")
            
        if i + batch_size < len(products_to_process):
            print("Sleeping for 5 seconds to respect rate limits...")
            time.sleep(5)

    print("\nProcessing complete. Verifying final dataset...")
    df_final = pd.read_csv(output_file)
    print(f"Total rows in final dataset: {len(df_final)}")
    print(df_final['core_step'].value_counts())

def run_agentic_cleaning(input_csv="data/nigerian_prices.csv", output_csv="data/nigerian_prices_agentic.csv", api_keys=None, shops_filter=None):
    """Entry point for pipeline integration."""
    global API_KEYS, current_key_index
    if api_keys:
        API_KEYS = api_keys if isinstance(api_keys, list) else api_keys.split(",")
    current_key_index = 0
    
    # Call existing main() logic but with custom paths
    main(input_csv=input_csv, output_csv=output_csv, shops_filter=shops_filter)

if __name__ == "__main__":
    main()
