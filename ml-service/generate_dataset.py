import random
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd


SEED = 42
SAMPLE_NORMAL = 500000
NUM_CHAINS = 45
NUM_STARS = 30
SOURCE_PATH = "data/PS_20174392719_1491204439457_log.csv"
TRANSACTIONS_PATH = "data/transactions.csv"
ACCOUNTS_PATH = "data/accounts.csv"

TRANSACTION_COLUMNS = [
    "transaction_id", "sender_account_id", "sender_vpa", "receiver_account_id",
    "receiver_vpa", "amount", "type", "step", "timestamp", "status",
    "device_id", "is_fraud", "is_synthetic_ring", "ring_id", "ring_type",
    "sender_old_balance", "sender_new_balance",
]
ACCOUNT_COLUMNS = [
    "account_id", "vpa_address", "account_holder_name", "account_age_days",
    "kyc_status", "current_balance", "avg_tx_amount", "tx_frequency_per_day",
    "unique_counterparties", "device_id", "ip_address", "risk_status", "created_at",
]

NAMES = [
    "Aarav Sharma", "Aditi Iyer", "Arjun Mehta", "Diya Nair", "Ishaan Rao",
    "Kavya Menon", "Manav Kapoor", "Meera Joshi", "Neel Patel", "Riya Verma",
    "Rohan Das", "Saanvi Shah", "Vihaan Kulkarni", "Ananya Singh", "Kabir Bhat",
]


def vpa(account_id):
    return account_id.lower() + "@upi"


def make_ring_rows(rng):
    rows = []
    ring_metadata = {}
    for ring_number in range(1, NUM_CHAINS + 1):
        ring_id = "ring_chain_%02d" % ring_number
        hop_count = rng.randint(3, 5)
        start_step = rng.randint(1, 700)
        accounts = ["acc_chain_%02d_%d" % (ring_number, i) for i in range(hop_count + 1)]
        amount = rng.uniform(50000, 500000)
        for hop in range(hop_count):
            sent_amount = round(amount, 2)
            rows.append({
                "step": start_step + hop,
                "type": "TRANSFER" if hop < hop_count - 1 else "CASH_OUT",
                "amount": sent_amount,
                "nameOrig": accounts[hop],
                "oldbalanceOrg": sent_amount,
                "newbalanceOrig": 0.0,
                "nameDest": accounts[hop + 1],
                "isFraud": True,
                "is_synthetic_ring": True,
                "ring_id": ring_id,
                "ring_type": "chain",
            })
            amount *= rng.uniform(0.95, 0.98)
        ring_metadata[ring_id] = {"type": "chain", "accounts": accounts}

    for ring_number in range(1, NUM_STARS + 1):
        ring_id = "ring_star_%02d" % ring_number
        victim_count = rng.randint(3, 6)
        start_step = rng.randint(1, 700)
        mule = "acc_star_%02d_mule" % ring_number
        final_account = "acc_star_%02d_final" % ring_number
        victims = ["acc_star_%02d_victim%d" % (ring_number, i) for i in range(victim_count)]
        victim_amounts = []
        for offset, victim in enumerate(victims):
            sent_amount = round(rng.uniform(20000, 200000), 2)
            victim_amounts.append(sent_amount)
            rows.append({
                "step": start_step + offset,
                "type": "TRANSFER",
                "amount": sent_amount,
                "nameOrig": victim,
                "oldbalanceOrg": sent_amount,
                "newbalanceOrig": 0.0,
                "nameDest": mule,
                "isFraud": True,
                "is_synthetic_ring": True,
                "ring_id": ring_id,
                "ring_type": "star",
            })
        total_received = sum(victim_amounts)
        rows.append({
            "step": start_step + victim_count,
            "type": "CASH_OUT",
            "amount": round(total_received * 0.97, 2),
            "nameOrig": mule,
            "oldbalanceOrg": round(total_received, 2),
            "newbalanceOrig": 0.0,
            "nameDest": final_account,
            "isFraud": True,
            "is_synthetic_ring": True,
            "ring_id": ring_id,
            "ring_type": "star",
        })
        ring_metadata[ring_id] = {"type": "star", "mule": mule, "final": final_account, "victims": victims}
    return rows, ring_metadata


def assign_profiles(transactions, ring_metadata, rng):
    account_ids = sorted(set(transactions["sender_account_id"]) | set(transactions["receiver_account_id"]))
    synthetic_accounts = set()
    chain_relays = set()
    star_mules = set()
    star_finals = set()
    star_victims = set()
    chain_first_accounts = set()
    for metadata in ring_metadata.values():
        if metadata["type"] == "chain":
            chain_first_accounts.add(metadata["accounts"][0])
            chain_relays.update(metadata["accounts"][1:])
            synthetic_accounts.update(metadata["accounts"])
        else:
            star_mules.add(metadata["mule"])
            star_finals.add(metadata["final"])
            star_victims.update(metadata["victims"])
            synthetic_accounts.update(metadata["victims"] + [metadata["mule"], metadata["final"]])

    fraud_touch_accounts = set(transactions.loc[transactions["is_fraud"], "sender_account_id"])
    fraud_touch_accounts.update(transactions.loc[transactions["is_fraud"], "receiver_account_id"])
    real_fraud_accounts = fraud_touch_accounts - synthetic_accounts
    normal_accounts = set(account_ids) - fraud_touch_accounts
    normal_looking_fraud = set(rng.sample(sorted(real_fraud_accounts), int(len(real_fraud_accounts) * 0.15)))
    suspicious_normal = set(rng.sample(sorted(normal_accounts), max(1, int(len(normal_accounts) * 0.05))))

    profiles = {}
    for number, account_id in enumerate(account_ids):
        if account_id in star_mules:
            age = rng.randint(7, 30)
            kyc = "MINIMUM_KYC"
            device = "DEV_EMULATOR_%02d" % int(account_id.split("_")[2])
            ip = "185.220.%d.%d" % (number % 200, (number * 7) % 250)
        elif account_id in chain_relays or account_id in star_finals:
            age = rng.randint(1, 14)
            kyc = "PARTIAL_MINIMUM_OTP"
            ring_number = int(account_id.split("_")[2])
            device = "DEV_EMULATOR_%02d" % ring_number
            ip = "103.21.%d.%d" % (number % 200, (number * 11) % 250)
        elif account_id in chain_first_accounts or account_id in star_victims:
            age = rng.randint(300, 1000) if account_id in chain_first_accounts else rng.randint(180, 1500)
            kyc = "FULL_BIOMETRIC_VERIFIED"
            device = "DEV_%d" % number
            ip = "49.36.%d.%d" % (number % 200, (number * 13) % 250)
        elif account_id in normal_looking_fraud:
            age = rng.randint(600, 1200)
            kyc = "FULL_BIOMETRIC_VERIFIED"
            device = "DEV_%d" % number
            ip = "122.161.%d.%d" % (number % 200, (number * 17) % 250)
        elif account_id in real_fraud_accounts:
            age = rng.randint(1, 14)
            kyc = "PARTIAL_MINIMUM_OTP"
            device = "DEV_RELAY_%d" % number
            ip = "103.21.%d.%d" % (number % 200, (number * 17) % 250)
        elif account_id in suspicious_normal:
            age = rng.randint(10, 30)
            kyc = rng.choice(["PARTIAL_MINIMUM_OTP", "MINIMUM_KYC"])
            device = "DEV_SUSPICIOUS_%d" % number
            ip = "103.21.%d.%d" % (number % 200, (number * 19) % 250)
        else:
            age = rng.randint(180, 1500)
            kyc = "FULL_BIOMETRIC_VERIFIED" if rng.random() < 0.82 else rng.choice(["PARTIAL_MINIMUM_OTP", "MINIMUM_KYC"])
            device = "DEV_%d" % number
            ip = rng.choice(["49.36.%d.%d", "122.161.%d.%d"]) % (number % 200, (number * 23) % 250)
        profiles[account_id] = {"age": age, "kyc": kyc, "device": device, "ip": ip}
    for ring_id, metadata in ring_metadata.items():
        ring_number = int(ring_id.split("_")[-1])
        ring_device = "DEV_EMULATOR_%02d" % ring_number
        ring_accounts = metadata["accounts"] if metadata["type"] == "chain" else metadata["victims"] + [metadata["mule"], metadata["final"]]
        for account_id in ring_accounts:
            profiles[account_id]["device"] = ring_device
    return profiles


def main():
    random.seed(SEED)
    np.random.seed(SEED)
    rng = random.Random(SEED)
    source = pd.read_csv(SOURCE_PATH)
    fraud = source[source["isFraud"] == 1]
    normal = source[source["isFraud"] == 0].sample(n=SAMPLE_NORMAL, random_state=SEED)
    real = pd.concat([fraud, normal], ignore_index=True)
    real["amount"] = real["amount"].clip(lower=0.01)
    ring_rows, ring_metadata = make_ring_rows(rng)

    real_transactions = pd.DataFrame({
        "step": real["step"], "type": real["type"], "amount": real["amount"],
        "nameOrig": real["nameOrig"], "oldbalanceOrg": real["oldbalanceOrg"],
        "newbalanceOrig": real["newbalanceOrig"], "nameDest": real["nameDest"],
        "isFraud": real["isFraud"].astype(bool), "is_synthetic_ring": False,
        "ring_id": None, "ring_type": None,
    })
    combined = pd.concat([real_transactions, pd.DataFrame(ring_rows)], ignore_index=True)
    combined = combined.sort_values(["step", "is_synthetic_ring"], kind="stable").reset_index(drop=True)
    profile_input = combined.rename(columns={"nameOrig": "sender_account_id", "nameDest": "receiver_account_id", "isFraud": "is_fraud"})
    profiles = assign_profiles(profile_input, ring_metadata, rng)

    timestamps = [datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(hours=int(step)) for step in combined["step"]]
    transactions = pd.DataFrame({
        "transaction_id": ["tx_%06d" % (i + 1) for i in range(len(combined))],
        "sender_account_id": combined["nameOrig"], "sender_vpa": combined["nameOrig"].map(vpa),
        "receiver_account_id": combined["nameDest"], "receiver_vpa": combined["nameDest"].map(vpa),
        "amount": combined["amount"].astype(float), "type": combined["type"],
        "step": combined["step"].astype(int), "timestamp": [stamp.isoformat() for stamp in timestamps],
        "status": "SUCCESS", "device_id": combined["nameOrig"].map(lambda account: profiles[account]["device"]),
        "is_fraud": combined["isFraud"].astype(bool), "is_synthetic_ring": combined["is_synthetic_ring"].astype(bool),
        "ring_id": combined["ring_id"], "ring_type": combined["ring_type"],
        "sender_old_balance": combined["oldbalanceOrg"].astype(float), "sender_new_balance": combined["newbalanceOrig"].astype(float),
    })

    stats = {}
    balances = {}
    counterparties = {}
    for row in transactions.itertuples(index=False):
        stats.setdefault(row.sender_account_id, []).append(row.amount)
        stats.setdefault(row.receiver_account_id, []).append(row.amount)
        counterparties.setdefault(row.sender_account_id, set()).add(row.receiver_account_id)
        counterparties.setdefault(row.receiver_account_id, set()).add(row.sender_account_id)
        balances[row.sender_account_id] = row.sender_new_balance
        balances[row.receiver_account_id] = row.amount

    account_rows = []
    created_base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    for account_id in sorted(stats):
        profile = profiles[account_id]
        account_rows.append({
            "account_id": account_id, "vpa_address": vpa(account_id),
            "account_holder_name": NAMES[sum(ord(char) for char in account_id) % len(NAMES)],
            "account_age_days": profile["age"], "kyc_status": profile["kyc"],
            "current_balance": float(balances.get(account_id, 0.0)), "avg_tx_amount": float(np.mean(stats[account_id])),
            "tx_frequency_per_day": len(stats[account_id]) / 31.0, "unique_counterparties": len(counterparties[account_id]),
            "device_id": profile["device"], "ip_address": profile["ip"], "risk_status": "ACTIVE",
            "created_at": (created_base - timedelta(days=profile["age"])).date().isoformat(),
        })
    accounts = pd.DataFrame(account_rows, columns=ACCOUNT_COLUMNS)
    transactions.to_csv(TRANSACTIONS_PATH, index=False)
    accounts.to_csv(ACCOUNTS_PATH, index=False)

    print("rows in transactions.csv:", len(transactions))
    print("rows in accounts.csv:", len(accounts))
    print("fraud rows:", int(transactions["is_fraud"].sum()))
    print("injected ring rows:", int(transactions["is_synthetic_ring"].sum()))
    print("number of rings by type:", transactions[transactions["is_synthetic_ring"]].groupby("ring_type")["ring_id"].nunique().to_dict())


if __name__ == "__main__":
    main()