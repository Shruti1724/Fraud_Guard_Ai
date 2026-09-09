import pandas as pd

df = pd.read_csv("data/PS_20174392719_1491204439457_log.csv")

print("Rows:", len(df))
print("\nColumns:", list(df.columns))
print("\nFraud count:", df['isFraud'].sum())
print("Fraud %:", round(df['isFraud'].mean() * 100, 4))
print("\nType counts:\n", df['type'].value_counts())