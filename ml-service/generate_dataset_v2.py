import argparse
import random
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split

SEED = 42
SAMPLE_NORMAL = 500000
QUICK_SAMPLE_NORMAL = 50000
NUM_CHAINS = 40
NUM_STARS = 35
NUM_CYCLES = 25
NUM_FANOUTS = 25
NUM_HYBRIDS = 25
NUM_MERCHANT_HUBS = 60
NUM_PAYROLL_FANOUTS = 25
NUM_FORWARD_CHAINS = 50
NUM_FAMILY_GROUPS = 40
SOURCE_PATH = "data/PS_20174392719_1491204439457_log.csv"
TRANSACTION_COLUMNS = ["transaction_id", "sender_account_id", "sender_vpa", "receiver_account_id", "receiver_vpa", "amount", "type", "step", "timestamp", "status", "device_id", "is_fraud", "is_synthetic_ring", "ring_id", "ring_type", "sender_old_balance", "sender_new_balance", "decoy_id", "decoy_type"]
ACCOUNT_COLUMNS = ["account_id", "vpa_address", "account_holder_name", "account_age_days", "kyc_status", "current_balance", "avg_tx_amount", "tx_frequency_per_day", "unique_counterparties", "device_id", "ip_address", "risk_status", "created_at"]
LABEL_COLUMNS = ["account_id", "role", "group_type", "group_id", "label_touch", "label_mule"]
SPLIT_COLUMNS = ["account_id", "split", "fold", "label_touch", "label_mule", "role", "group_type", "group_id", "ring_type", "decoy_type"]
NAMES = ["Aarav Sharma", "Aditi Iyer", "Arjun Mehta", "Diya Nair", "Ishaan Rao", "Kavya Menon", "Manav Kapoor", "Meera Joshi", "Neel Patel", "Riya Verma", "Rohan Das", "Saanvi Shah", "Vihaan Kulkarni", "Ananya Singh", "Kabir Bhat"]
RING_TYPES = ["chain", "star", "cycle", "fanout", "hybrid"]
DECOY_TYPES = ["merchant_hub", "payroll_fanout", "forward_chain", "family_group"]


def vpa(account_id):
    return account_id.lower() + "@upi"


def row(sender, receiver, amount, kind, step, fraud=False, synthetic=False, ring_id=None, ring_type=None, decoy_id=None, decoy_type=None):
    amount = round(max(0.01, float(amount)), 2)
    return {"sender": sender, "receiver": receiver, "amount": amount, "type": kind, "step": int(step), "is_fraud": bool(fraud), "is_synthetic_ring": bool(synthetic), "ring_id": ring_id, "ring_type": ring_type, "decoy_id": decoy_id, "decoy_type": decoy_type}


def add_group(groups, group_id, group_type, subtype, accounts, rows, roles):
    assert not groups["used_accounts"].intersection(accounts), "account belongs to two groups"
    groups["used_accounts"].update(accounts)
    groups["info"][group_id] = {"group_type": group_type, "subtype": subtype, "accounts": list(accounts), "roles": roles}
    groups["rows"].extend(rows)


def timing(rng, start, force_slow=False):
    if not force_slow and rng.random() < 0.8:
        return start + 1
    return start + rng.randint(5, 30)


def make_fraud_groups(rng, existing_pool, quick):
    groups = {"used_accounts": set(), "info": {}, "rows": []}
    counts = {"chain": max(1, NUM_CHAINS // 5) if quick else NUM_CHAINS, "star": max(1, NUM_STARS // 5) if quick else NUM_STARS, "cycle": max(1, NUM_CYCLES // 5) if quick else NUM_CYCLES, "fanout": max(1, NUM_FANOUTS // 5) if quick else NUM_FANOUTS, "hybrid": max(1, NUM_HYBRIDS // 5) if quick else NUM_HYBRIDS}
    existing = list(existing_pool)
    cursor = 0
    def account(prefix, n, allow_existing=False):
        nonlocal cursor
        if allow_existing and cursor < len(existing):
            value = existing[cursor]
            cursor += 1
            return value
        return "acc_%s_%03d_%d" % (prefix, len(groups["info"]) + 1, n)
    for number in range(1, counts["chain"] + 1):
        gid = "ring_chain_%02d" % number; hops = rng.randint(3, 6); start = rng.randint(1, 700)
        accts = [account("chain", i, i == 0 and rng.random() < 0.5) for i in range(hops + 1)]
        amount = rng.choice([rng.randint(5, 50) * 10000, rng.uniform(50000, 500000)]) if rng.random() < 0.2 else rng.uniform(50000, 500000)
        decay = rng.uniform(0.95, 0.98) if rng.random() < 0.6 else rng.uniform(0.85, 0.99)
        rows = []; step = start
        for hop in range(hops):
            sent = amount; rows.append(row(accts[hop], accts[hop + 1], sent, "CASH_OUT" if hop == hops - 1 else "TRANSFER", step, True, True, gid, "chain")); amount *= decay; step = timing(rng, step, number % 5 == 0)
        add_group(groups, gid, "ring", "chain", accts, rows, {accts[0]: "source", **{a: "relay/final" for a in accts[1:]}})
    for number in range(1, counts["star"] + 1):
        gid = "ring_star_%02d" % number; victims_n = rng.randint(3, 8); start = rng.randint(1, 700)
        victims = [account("star_victim", i, rng.random() < 0.5) for i in range(victims_n)]; mule = account("star_mule", 0); final = account("star_final", 0); accts = victims + [mule, final]; rows = []; total = 0.0; step = start
        for victim in victims:
            amount = rng.uniform(20000, 200000); total += amount; rows.append(row(victim, mule, amount, "TRANSFER", step, True, True, gid, "star")); step += 1
        rows.append(row(mule, final, total * rng.uniform(0.90, 0.99), "CASH_OUT", step, True, True, gid, "star"))
        add_group(groups, gid, "ring", "star", accts, rows, {**{a: "victim" for a in victims}, mule: "mule", final: "final"})
    for number in range(1, counts["cycle"] + 1):
        gid = "ring_cycle_%02d" % number; n = rng.randint(3, 5); laps = rng.randint(1, 2); start = rng.randint(1, 700); accts = [account("cycle", i) for i in range(n)]; rows = []; amount = rng.uniform(50000, 250000); step = start
        for _ in range(laps):
            for i in range(n):
                rows.append(row(accts[i], accts[(i + 1) % n], amount, "TRANSFER", step, True, True, gid, "cycle")); amount *= rng.uniform(0.96, 0.98); step = timing(rng, step, number % 5 == 0)
        sink = account("cycle_sink", 0); rows.append(row(accts[0], sink, amount, "CASH_OUT", step, True, True, gid, "cycle")); accts.append(sink)
        add_group(groups, gid, "ring", "cycle", accts, rows, {a: "relay/final" for a in accts})
    for number in range(1, counts["fanout"] + 1):
        gid = "ring_fanout_%02d" % number; n = rng.randint(4, 8); start = rng.randint(1, 700); source = account("fanout_source", 0); smurfs = [account("fanout_smurf", i) for i in range(n)]; collector = account("fanout_collector", 0); sink = account("fanout_sink", 0); total = rng.uniform(100000, 500000); parts = [total * rng.uniform(0.12, 0.25) for _ in smurfs]; scale = total * 0.8 / sum(parts); parts = [p * scale for p in parts]; rows = []; step = start
        for smurf, amount in zip(smurfs, parts): rows.append(row(source, smurf, amount, "TRANSFER", step, True, True, gid, "fanout")); step += 1
        for smurf, amount in zip(smurfs, parts): rows.append(row(smurf, collector, amount, "TRANSFER", step, True, True, gid, "fanout")); step += 1
        rows.append(row(collector, sink, sum(parts) * rng.uniform(0.94, 0.99), "CASH_OUT", step, True, True, gid, "fanout"))
        add_group(groups, gid, "ring", "fanout", [source] + smurfs + [collector, sink], rows, {source: "source", **{a: "smurf" for a in smurfs}, collector: "collector", sink: "final"})
    for number in range(1, counts["hybrid"] + 1):
        gid = "ring_hybrid_%02d" % number; chain_n = rng.randint(2, 3); fan_n = rng.randint(3, 5); start = rng.randint(1, 700); chain = [account("hybrid", i, i == 0 and rng.random() < 0.5) for i in range(chain_n + 1)]; branches = [account("hybrid_branch", i) for i in range(fan_n)]; finals = [account("hybrid_final", i) for i in range(fan_n)]; rows = []; amount = rng.uniform(80000, 350000); step = start
        for i in range(chain_n): rows.append(row(chain[i], chain[i + 1], amount, "TRANSFER", step, True, True, gid, "hybrid")); amount *= rng.uniform(0.9, 0.98); step = timing(rng, step, number % 5 == 0)
        for branch in branches: rows.append(row(chain[-1], branch, amount / fan_n, "TRANSFER", step, True, True, gid, "hybrid")); step += 1
        for branch, final in zip(branches, finals): rows.append(row(branch, final, amount / fan_n * rng.uniform(0.9, 0.99), "CASH_OUT", step, True, True, gid, "hybrid")); step += 1
        accts = chain + branches + finals; roles = {chain[0]: "source", **{a: "relay/final" for a in accts[1:]}}
        add_group(groups, gid, "ring", "hybrid", accts, rows, roles)
    return groups


def make_decoy_groups(rng, existing_pool, quick, used):
    groups = {"used_accounts": set(used), "info": {}, "rows": []}; existing = list(existing_pool); cursor = 0
    counts = {"merchant_hub": max(1, NUM_MERCHANT_HUBS // 5) if quick else NUM_MERCHANT_HUBS, "payroll_fanout": max(1, NUM_PAYROLL_FANOUTS // 5) if quick else NUM_PAYROLL_FANOUTS, "forward_chain": max(1, NUM_FORWARD_CHAINS // 5) if quick else NUM_FORWARD_CHAINS, "family_group": max(1, NUM_FAMILY_GROUPS // 5) if quick else NUM_FAMILY_GROUPS}
    def account(prefix, n, use_existing=False):
        nonlocal cursor
        if use_existing:
            while cursor < len(existing) and existing[cursor] in groups["used_accounts"]: cursor += 1
            if cursor < len(existing): value = existing[cursor]; cursor += 1; return value
        return "acc_%s_%03d_%d" % (prefix, len(groups["info"]) + 1, n)
    for number in range(1, counts["merchant_hub"] + 1):
        gid = "decoy_merchant_hub_%02d" % number; merchant = account("merchant", 0); n = rng.randint(5, 40); customers = [account("merchant_customer", i, rng.random() < 0.7) for i in range(n)]; rows = [row(customer, merchant, rng.uniform(100, 5000), rng.choice(["PAYMENT", "TRANSFER"]), rng.randint(100, 700), False, False, None, None, gid, "merchant_hub") for customer in customers]; bank = account("merchant_bank", 0); rows += [row(merchant, bank, rng.uniform(1000, 10000), "CASH_OUT", rng.randint(100, 700), False, False, None, None, gid, "merchant_hub")]; add_group(groups, gid, "decoy", "merchant_hub", [merchant] + customers + [bank], rows, {a: "decoy" for a in [merchant] + customers + [bank]})
    for number in range(1, counts["payroll_fanout"] + 1):
        gid = "decoy_payroll_fanout_%02d" % number; employer = account("employer", 0); n = rng.randint(5, 30); employees = [account("employee", i, rng.random() < 0.7) for i in range(n)]; rows = []; base = rng.randint(1, 500); repeats = rng.randint(1, 3)
        for repeat in range(repeats): rows += [row(employer, employee, rng.uniform(25000, 80000), "TRANSFER", base + repeat * rng.randint(200, 300), False, False, None, None, gid, "payroll_fanout") for employee in employees]
        add_group(groups, gid, "decoy", "payroll_fanout", [employer] + employees, rows, {a: "decoy" for a in [employer] + employees})
    for number in range(1, counts["forward_chain"] + 1):
        gid = "decoy_forward_chain_%02d" % number; n = rng.randint(3, 5); accts = [account("forward", i, rng.random() < 0.5 if i == 0 else False) for i in range(n + 1)]; amount = rng.uniform(1000, 50000); step = rng.randint(1, 700); rows = []
        fast = number % 4 == 0
        for i in range(n): rows.append(row(accts[i], accts[i + 1], amount, "TRANSFER", step, False, False, None, None, gid, "forward_chain")); amount *= rng.uniform(0.95, 0.98) if rng.random() < 0.2 else rng.uniform(0.60, 1.0); step += 1 if fast else rng.randint(1, 72)
        add_group(groups, gid, "decoy", "forward_chain", accts, rows, {a: "decoy" for a in accts})
    for number in range(1, counts["family_group"] + 1):
        gid = "decoy_family_group_%02d" % number; n = rng.randint(3, 6); accts = [account("family", i, rng.random() < 0.5) for i in range(n)]; rows = []; step = rng.randint(1, 700)
        for i in range(rng.randint(6, 15)):
            sender = accts[i % n]; receiver = accts[(i + 1) % n] if i != 1 else accts[0]; rows.append(row(sender, receiver, rng.uniform(50, 5000), "TRANSFER", step, False, False, None, None, gid, "family_group")); step += rng.randint(1, 70)
        add_group(groups, gid, "decoy", "family_group", accts, rows, {a: "decoy" for a in accts})
    return groups


def profiles_for(accounts, group_info, fraud_ids, rng):
    account_groups = {}
    for info in group_info.values():
        for account_id in info["accounts"]:
            account_groups[account_id] = info
    profiles = {}
    for number, account_id in enumerate(sorted(accounts)):
        info = account_groups.get(account_id)
        if info and info["group_type"] == "ring" and rng.random() < 0.65:
            age = rng.randint(1, 30); kyc = rng.choice(["PARTIAL_MINIMUM_OTP", "MINIMUM_KYC"])
        elif info and info["group_type"] == "ring":
            age = rng.randint(60, 700); kyc = rng.choice(["FULL_BIOMETRIC_VERIFIED", "PARTIAL_MINIMUM_OTP", "MINIMUM_KYC"])
        elif info and info["group_type"] == "decoy" and rng.random() < 0.25:
            age = rng.randint(1, 30); kyc = rng.choice(["PARTIAL_MINIMUM_OTP", "MINIMUM_KYC"])
        elif account_id in fraud_ids and rng.random() < 0.7:
            age = rng.randint(1, 30); kyc = rng.choice(["PARTIAL_MINIMUM_OTP", "MINIMUM_KYC"])
        elif rng.random() < 0.05:
            age = rng.randint(1, 30); kyc = rng.choice(["PARTIAL_MINIMUM_OTP", "MINIMUM_KYC"])
        else:
            age = rng.randint(180, 1500); kyc = "FULL_BIOMETRIC_VERIFIED" if rng.random() < 0.82 else rng.choice(["PARTIAL_MINIMUM_OTP", "MINIMUM_KYC"])
        device = "DEV_EMULATOR_%03d" % number if info and info["group_type"] == "ring" and rng.random() < 0.6 else "DEV_%d" % number
        ip = rng.choice(["49.36.%d.%d", "122.161.%d.%d"]) % (number % 200, number % 250) if rng.random() < 0.3 else "103.21.%d.%d" % (number % 200, number % 250)
        profiles[account_id] = {"age": age, "kyc": kyc, "device": device, "ip": ip}
    return profiles


def main():
    parser = argparse.ArgumentParser(); parser.add_argument("--seed", type=int, default=SEED); parser.add_argument("--out-dir", default="data/v2"); parser.add_argument("--quick", action="store_true"); args = parser.parse_args(); rng = random.Random(args.seed); np.random.seed(args.seed)
    os = __import__("os"); os.makedirs(args.out_dir, exist_ok=True)
    source = pd.read_csv(SOURCE_PATH); normal_n = QUICK_SAMPLE_NORMAL if args.quick else SAMPLE_NORMAL; fraud = source[source["isFraud"] == 1]; normal = source[source["isFraud"] == 0].sample(n=normal_n, random_state=args.seed); base = pd.concat([fraud, normal], ignore_index=True); base["amount"] = base["amount"].clip(lower=0.01)
    existing_pool = sorted(set(normal["nameOrig"]) | set(normal["nameDest"])); fraud_groups = make_fraud_groups(rng, existing_pool, args.quick); decoys = make_decoy_groups(rng, existing_pool, args.quick, fraud_groups["used_accounts"]); group_info = dict(fraud_groups["info"], **decoys["info"]); assert sum(len(i["accounts"]) for i in group_info.values()) == len(set(a for i in group_info.values() for a in i["accounts"]))
    rows = [row(r["nameOrig"], r["nameDest"], r["amount"], r["type"], r["step"], bool(r["isFraud"]), False) for r in base.to_dict("records")]
    rows.extend(fraud_groups["rows"]); rows.extend(decoys["rows"])
    group_accounts = set(a for info in group_info.values() for a in info["accounts"]); ordinary = [a for a in existing_pool if a not in group_accounts]
    for gid, info in list(group_info.items()):
        for account_id in info["accounts"]:
            for _ in range(rng.randint(0, 4)):
                other = rng.choice(ordinary); rows.append(row(account_id, other, rng.uniform(100, 10000), rng.choice(["PAYMENT", "CASH_IN", "CASH_OUT", "TRANSFER"]), rng.randint(1, 743), False, False))
    accounts_in_rows = sorted(set(r["sender"] for r in rows) | set(r["receiver"] for r in rows)); fraud_ids = set(r["sender"] for r in rows if r["is_fraud"]) | set(r["receiver"] for r in rows if r["is_fraud"]); profiles = profiles_for(accounts_in_rows, group_info, fraud_ids, rng)
    tx_rows = []; stats = defaultdict(list); balances = {}; counterparties = defaultdict(set)
    for idx, r in enumerate(sorted(rows, key=lambda x: (x["step"], x["is_synthetic_ring"], x["sender"]))):
        sender, receiver = r["sender"], r["receiver"]; stats[sender].append(r["amount"]); stats[receiver].append(r["amount"]); counterparties[sender].add(receiver); counterparties[receiver].add(sender); balances[sender] = 0.0 if r["is_synthetic_ring"] else r["amount"]; balances[receiver] = r["amount"]
        tx_rows.append({"transaction_id": "tx_%07d" % (idx + 1), "sender_account_id": sender, "sender_vpa": vpa(sender), "receiver_account_id": receiver, "receiver_vpa": vpa(receiver), "amount": r["amount"], "type": r["type"], "step": r["step"], "timestamp": (datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(hours=r["step"])).isoformat(), "status": "SUCCESS", "device_id": profiles[sender]["device"], "is_fraud": r["is_fraud"], "is_synthetic_ring": r["is_synthetic_ring"], "ring_id": r["ring_id"], "ring_type": r["ring_type"], "sender_old_balance": r["amount"], "sender_new_balance": 0.0 if r["is_synthetic_ring"] else r["amount"], "decoy_id": r["decoy_id"], "decoy_type": r["decoy_type"]})
    transactions = pd.DataFrame(tx_rows, columns=TRANSACTION_COLUMNS); account_rows = []
    for account_id in accounts_in_rows:
        p = profiles[account_id]; account_rows.append({"account_id": account_id, "vpa_address": vpa(account_id), "account_holder_name": NAMES[sum(map(ord, account_id)) % len(NAMES)], "account_age_days": p["age"], "kyc_status": p["kyc"], "current_balance": float(balances.get(account_id, 0.0)), "avg_tx_amount": float(np.mean(stats[account_id])), "tx_frequency_per_day": len(stats[account_id]) / 31.0, "unique_counterparties": len(counterparties[account_id]), "device_id": p["device"], "ip_address": p["ip"], "risk_status": "ACTIVE", "created_at": (datetime(2026, 1, 1) - timedelta(days=p["age"])).date().isoformat()})
    accounts = pd.DataFrame(account_rows, columns=ACCOUNT_COLUMNS); roles = {}; group_for = {}; label_mule = defaultdict(int)
    for gid, info in group_info.items():
        for account_id, role in info["roles"].items(): roles[account_id] = role; group_for[account_id] = (info["group_type"], gid, info["subtype"]); label_mule[account_id] = int(info["group_type"] == "ring" and role not in ["source", "victim"])
    for r in base.to_dict("records"):
        if r["isFraud"]: label_mule[r["nameDest"]] = max(label_mule[r["nameDest"]], 1); roles.setdefault(r["nameOrig"], "victim"); roles.setdefault(r["nameDest"], "mule"); group_for.setdefault(r["nameOrig"], ("none", None, None)); group_for.setdefault(r["nameDest"], ("none", None, None))
    labels = pd.DataFrame([{"account_id": a, "role": roles.get(a, "ordinary"), "group_type": group_for.get(a, ("none", None, None))[0], "group_id": group_for.get(a, ("none", None, None))[1], "label_touch": int(a in fraud_ids), "label_mule": int(label_mule[a])} for a in accounts_in_rows], columns=LABEL_COLUMNS)
    group_types = {gid: info["subtype"] for gid, info in group_info.items()}; group_ids = list(group_info); rng.shuffle(group_ids); test_groups = set()
    for subtype in RING_TYPES + DECOY_TYPES:
        ids = [gid for gid in group_ids if group_types[gid] == subtype]; test_groups.update(ids[:max(1, int(round(len(ids) * 0.3)))])
    label_lookup = labels.set_index("account_id")
    split_values = {}; folds = {}; remaining = [a for a in accounts_in_rows if a not in group_for or group_for[a][1] is None]; rem_train, rem_test = ([], []) if not remaining else (train_test_split(remaining, test_size=0.3, random_state=args.seed, stratify=label_lookup.loc[remaining, "label_mule"])[0:2]); split_values.update({a: "train" for a in rem_train}); split_values.update({a: "test" for a in rem_test})
    for gid, info in group_info.items():
        for a in info["accounts"]: split_values[a] = "test" if gid in test_groups else "train"
    for subtype in RING_TYPES + DECOY_TYPES:
        fold_groups = [gid for gid in group_ids if group_types[gid] == subtype]
        rng.shuffle(fold_groups)
        for i, gid in enumerate(fold_groups):
            for a in group_info[gid]["accounts"]: folds[a] = i % 5
    for i, a in enumerate(remaining): folds[a] = i % 5
    split_rows = []
    for a in accounts_in_rows:
        gt, gid, subtype = group_for.get(a, ("none", None, None)); split_rows.append({"account_id": a, "split": split_values.get(a, "train"), "fold": folds[a], "label_touch": int(label_lookup.loc[a, "label_touch"]), "label_mule": int(label_lookup.loc[a, "label_mule"]), "role": roles.get(a, "ordinary"), "group_type": gt, "group_id": gid, "ring_type": subtype if gt == "ring" else None, "decoy_type": subtype if gt == "decoy" else None})
    splits = pd.DataFrame(split_rows, columns=SPLIT_COLUMNS)
    transactions.to_csv(args.out_dir + "/transactions.csv", index=False); accounts.to_csv(args.out_dir + "/accounts.csv", index=False); labels.to_csv(args.out_dir + "/labels.csv", index=False); splits.to_csv(args.out_dir + "/splits.csv", index=False)
    print("rows in transactions.csv:", len(transactions)); print("rows in accounts.csv:", len(accounts)); print("rows in labels.csv:", len(labels)); print("rows in splits.csv:", len(splits)); print("rings by type:", transactions[transactions.is_synthetic_ring].groupby("ring_type").ring_id.nunique().to_dict()); print("decoys by type:", transactions[transactions.decoy_id.notna()].groupby("decoy_type").decoy_id.nunique().to_dict()); print("label_touch counts:", labels.label_touch.value_counts().to_dict()); print("label_mule counts:", labels.label_mule.value_counts().to_dict())
    print("train/test groups by type:", splits[splits.group_id.notna()].groupby(["group_type", "ring_type", "decoy_type", "split"]).group_id.nunique().to_dict())


if __name__ == "__main__":
    main()
