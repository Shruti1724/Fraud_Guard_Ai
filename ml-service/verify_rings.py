import pandas as pd

df = pd.read_csv("data/paysim_with_injected_rings.csv")

rings_df = df[df['is_synthetic_ring'] == True]

# Look at one chain ring end-to-end
sample_chain = rings_df[rings_df['ring_id'] == 'chain1'].sort_values('step')
print("Sample chain ring:\n", sample_chain[['step', 'nameOrig', 'nameDest', 'amount', 'type']])

# Look at one star ring end-to-end
sample_star = rings_df[rings_df['ring_id'] == 'star1'].sort_values('step')
print("\nSample star ring:\n", sample_star[['step', 'nameOrig', 'nameDest', 'amount', 'type']])
