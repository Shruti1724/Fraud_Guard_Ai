import pandas as pd

df = pd.read_csv("data/PS_20174392719_1491204439457_log.csv")

fraud_df = df[df['isFraud'] == 1]
nonfraud_df = df[df['isFraud'] == 0]

# Does the sender's balance drop to zero after a fraud transaction?
fraud_df = fraud_df.copy()
fraud_df['orig_emptied'] = fraud_df['newbalanceOrig'] == 0
print("Fraud txns where sender balance goes to exactly 0:", fraud_df['orig_emptied'].sum(), "out of", len(fraud_df))

# Compare average amount: fraud vs non-fraud
print("\nAvg amount - Fraud:", fraud_df['amount'].mean())
print("Avg amount - Non-fraud:", nonfraud_df['amount'].mean())

# How many unique accounts appear as senders vs receivers overall?
print("\nUnique sender accounts:", df['nameOrig'].nunique())
print("Unique receiver accounts:", df['nameDest'].nunique())

# Do any accounts appear as BOTH sender and receiver? (needed for graph structure)
senders = set(df['nameOrig'])
receivers = set(df['nameDest'])
overlap = senders & receivers
print("\nAccounts that are both sender and receiver:", len(overlap))