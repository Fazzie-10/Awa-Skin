import pandas as pd
import os

def main():
    print("Building clean skincare prices dataset (data/nigerian_prices_clean.csv)...")
    
    source_file = "data/nigerian_prices.csv"
        
    df = pd.read_csv(source_file)
    print(f"Loaded {len(df)} records from {source_file}")
    
    target_shops = ["BuyBetter", "Teeka4", "BeautyByDaz", "SkinPopEssentiel", "PeronaBeauty_Lagos", "PeronaBeauty_Ibadan"]
    df = df[df["source_shop"].isin(target_shops)].copy()
    
    # Filter for sub_category == Face if sub_category exists
    if "sub_category" in df.columns:
        df = df[df["sub_category"].astype(str).str.lower() == "face"].copy()
        
    # Exclude non-skincare items based on keywords
    exclude_keywords = ["lip gloss", "eyelash", "makeup", "hair", "shampoo", "deodorant", "body wash", "body lotion", "hand cream", "toothpaste"]
    pattern = "|".join(exclude_keywords)
    df = df[~df["product_name"].astype(str).str.lower().str.contains(pattern, regex=True)].copy()
    
    # Clean product titles (strip "Unknown Product", bulk text, etc.)
    df["product_name"] = df["product_name"].astype(str).str.strip()
    df = df[~df["product_name"].str.lower().isin(["unknown product", "reduced price!"])].copy()
    
    # Ensure price is valid
    df = df[df["price_naira"].notna() & (df["price_naira"] > 0)].copy()
    
    # Drop duplicates by URL
    df = df.drop_duplicates(subset=["product_url"]).reset_index(drop=True)
    
    output_file = "data/nigerian_prices_clean.csv"
    df.to_csv(output_file, index=False)
    print(f"[Success] Saved clean CSV with {len(df)} pure face skincare records to {output_file}")
    
    print("\nShop distribution in clean dataset:")
    print(df["source_shop"].value_counts().to_string())

if __name__ == "__main__":
    main()
