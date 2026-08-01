import pandas as pd
import os
import re

def categorize_product(name):
    name = str(name).lower()
    
    # 1. Determine Core Step
    core_step = "Uncategorized"
    
    cleanse_keywords = ['wash', 'cleanser', 'soap', 'scrub', 'wipe', 'cleansing', 'foam', 'micellar', 'gel wash', 'face wash']
    treat_keywords = ['serum', 'essence', 'ampoule', 'acid', 'toner', 'treatment', 'peel', 'pad', 'mask', 'patch', 'bha', 'aha', 'pha', 'vitamin c', 'retinol', 'niacinamide', 'glow booster', 'tonic']
    moisturize_keywords = ['cream', 'lotion', 'moisturizer', 'moisturising', 'butter', 'gel cream', 'balm', 'oil', 'ceramide', 'moisture', 'emulsion']
    protect_keywords = ['sunscreen', 'spf', 'sun block', 'sun cream', 'uv', 'sun gel', 'sun protection']
    
    # Order of priority matters for some overlapping names
    if any(k in name for k in protect_keywords):
        core_step = "Protect"
    elif any(k in name for k in cleanse_keywords):
        core_step = "Cleanse"
    elif any(k in name for k in treat_keywords):
        core_step = "Treat"
    elif any(k in name for k in moisturize_keywords):
        core_step = "Moisturize"
    
    # 2. Determine Sub-Category
    sub_category = "Face" # default
    
    body_keywords = ['body', 'shower', 'deodorant', 'roll-on', 'armpit', 'underarm', 'hand', 'foot']
    lip_keywords = ['lip', 'balm', 'scrub'] # lip balm might trigger moisturize but subcat lip
    eye_keywords = ['eye', 'dark circle', 'hydrogel patch']
    makeup_keywords = ['foundation', 'eyeshadow', 'powder', 'palette', 'makeup', 'concealer', 'blush', 'primer', 'mascara', 'lipstick', 'lip gloss', 'tint']
    hair_keywords = ['hair', 'shampoo', 'conditioner', 'scalp']
    
    if any(k in name for k in makeup_keywords):
        sub_category = "Makeup"
        core_step = "Other" # makeup is usually not part of the 4 steps
    elif any(k in name for k in hair_keywords):
        sub_category = "Hair Care"
        core_step = "Other"
    elif any(k in name for k in body_keywords):
        sub_category = "Body"
    elif any(k in name for k in eye_keywords):
        sub_category = "Eye Care"
    elif any(k in name for k in lip_keywords):
        sub_category = "Lip Care"
        
    return core_step, sub_category

def main():
    input_file = "data/nigerian_prices.csv"
    output_file = "data/nigerian_prices_categorized.csv"
    
    print(f"Loading data from {input_file}...")
    df = pd.read_csv(input_file)
    
    target_shops = ['BuyBetter', 'Teeka4', 'BeautyByDaz']
    print(f"Filtering for shops: {target_shops}")
    df_filtered = df[df['source_shop'].isin(target_shops)].copy()
    print(f"Total products to process: {len(df_filtered)}")
    
    print("Applying categorization logic...")
    results = df_filtered['product_name'].apply(categorize_product)
    
    df_filtered['core_step'] = [res[0] for res in results]
    df_filtered['sub_category'] = [res[1] for res in results]
    
    # Reorder columns slightly for better viewing
    cols = ['product_name', 'brand', 'core_step', 'sub_category', 'price_naira', 'source_shop', 'product_url']
    if all(c in df_filtered.columns for c in cols):
        df_filtered = df_filtered[cols]
        
    print(f"\nSaving categorized data to {output_file}...")
    df_filtered.to_csv(output_file, index=False)
    
    # Print summary
    print("\n--- Summary by Core Step ---")
    print(df_filtered['core_step'].value_counts())
    
    print("\n--- Summary by Sub-Category ---")
    print(df_filtered['sub_category'].value_counts())
    
    print("\n--- Sample Uncategorized Products ---")
    uncat = df_filtered[df_filtered['core_step'] == 'Uncategorized']['product_name']
    print(f"Total Uncategorized: {len(uncat)}")
    if len(uncat) > 0:
        print(uncat.sample(min(10, len(uncat))).to_string())

if __name__ == "__main__":
    os.makedirs("scripts", exist_ok=True)
    main()
