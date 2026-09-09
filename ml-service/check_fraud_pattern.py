import pandas as pd

df = pd.read_csv("data/PS_20174392719_1491204439457_log.csv")

# Which transaction types actually have fraud?
fraud_df = df[df['isFraud'] == 1]
print("Fraud by type:\n", fraud_df['type'].value_counts())

# Check: does a fraudulent receiver (nameDest) ever appear as a sender (nameOrig) later?
# This tests whether money "hops" through multiple accounts (multi-hop chain)
fraud_dest_accounts = set(fraud_df['nameDest'])
hop_check = df[df['nameOrig'].isin(fraud_dest_accounts)]
print("\nTransactions where a fraud-receiving account later sends money onward:", len(hop_check))