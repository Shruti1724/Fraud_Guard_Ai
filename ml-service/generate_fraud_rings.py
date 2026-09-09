import pandas as pd
import random

random.seed(42)  # so results are reproducible for your report

df = pd.read_csv("data/PS_20174392719_1491204439457_log.csv")

synthetic_rows = []
NUM_CHAINS = 45
NUM_STARS = 30
base_step = int(df['step'].max())  # start injected activity after real data's timeline

def make_account(ring_id, idx):
    return f"FRAUD_RING_{ring_id}_ACC_{idx}"

# ---- CHAINS: A -> B -> C -> D (3-5 hops) ----
for ring_id in range(1, NUM_CHAINS + 1):
    chain_len = random.randint(3, 5)
    accounts = [make_account(f"chain{ring_id}", i) for i in range(chain_len + 1)]
    amount = random.uniform(50000, 500000)  # starting amount
    step = base_step + ring_id  # close together in time

    for hop in range(chain_len):
        sender = accounts[hop]
        receiver = accounts[hop + 1]
        sent_amount = amount
        amount = amount * random.uniform(0.95, 0.98)  # small cut taken each hop

        synthetic_rows.append({
            "step": step,
            "type": "TRANSFER" if hop < chain_len - 1 else "CASH_OUT",
            "amount": round(sent_amount, 2),
            "nameOrig": sender,
            "oldbalanceOrg": round(sent_amount, 2),
            "newbalanceOrig": 0.0,
            "nameDest": receiver,
            "oldbalanceDest": 0.0,
            "newbalanceDest": round(sent_amount, 2),
            "isFraud": 1,
            "isFlaggedFraud": 0,
            "is_synthetic_ring": True,
            "ring_id": f"chain{ring_id}",
            "ring_type": "chain"
        })
        step += 1  # next hop happens shortly after

# ---- STARS: multiple victims -> mule -> one final account ----
for ring_id in range(1, NUM_STARS + 1):
    num_victims = random.randint(3, 6)
    mule = make_account(f"star{ring_id}", "mule")
    final_receiver = make_account(f"star{ring_id}", "final")
    step = base_step + NUM_CHAINS + ring_id

    total_collected = 0
    for v in range(num_victims):
        victim = make_account(f"star{ring_id}", f"victim{v}")
        amt = random.uniform(20000, 200000)
        total_collected += amt

        synthetic_rows.append({
            "step": step,
            "type": "TRANSFER",
            "amount": round(amt, 2),
            "nameOrig": victim,
            "oldbalanceOrg": round(amt, 2),
            "newbalanceOrig": 0.0,
            "nameDest": mule,
            "oldbalanceDest": 0.0,
            "newbalanceDest": round(amt, 2),
            "isFraud": 1,
            "isFlaggedFraud": 0,
            "is_synthetic_ring": True,
            "ring_id": f"star{ring_id}",
            "ring_type": "star"
        })
        step += 1

    # mule forwards the collected money onward
    synthetic_rows.append({
        "step": step,
        "type": "CASH_OUT",
        "amount": round(total_collected * 0.97, 2),
        "nameOrig": mule,
        "oldbalanceOrg": round(total_collected, 2),
        "newbalanceOrig": 0.0,
        "nameDest": final_receiver,
        "oldbalanceDest": 0.0,
        "newbalanceDest": round(total_collected * 0.97, 2),
        "isFraud": 1,
        "isFlaggedFraud": 0,
        "is_synthetic_ring": True,
        "ring_id": f"star{ring_id}",
        "ring_type": "star"
    })

synthetic_df = pd.DataFrame(synthetic_rows)

# Add the missing columns to original df so they align when combined
df['is_synthetic_ring'] = False
df['ring_id'] = None
df['ring_type'] = None

combined_df = pd.concat([df, synthetic_df], ignore_index=True)
combined_df.to_csv("data/paysim_with_injected_rings.csv", index=False)

print("Original rows:", len(df))
print("Injected rows:", len(synthetic_df))
print("Combined rows:", len(combined_df))
print("\nRing type breakdown:\n", synthetic_df['ring_type'].value_counts())
print("\nTotal unique fraud rings injected:", synthetic_df['ring_id'].nunique())