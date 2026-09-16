/**
 * Known-good SHA-256 of every seed CSV, captured after verifying the seed zip itself
 * (vg-growthengineer-seed.zip) against the hash published in the case study brief:
 *
 *   4961a25b151ca13ac56089ca46b94def6074c315445ec193c7bf87060683d35c
 *
 * and confirming every extracted file is byte-identical to its zip member.
 * scripts/profile-seed.ts checks the files under seed/ against this manifest so a
 * corrupted or substituted seed file is caught before profiling runs on it.
 */
export const SEED_ZIP_SHA256 =
  "4961a25b151ca13ac56089ca46b94def6074c315445ec193c7bf87060683d35c";

export const SEED_FILE_SHA256: Record<string, string> = {
  "karoo-campaigns.csv":
    "2ea803928168eaddf3c08db832e513ab339d8fd0bd011a923094680a92ed9cb3",
  "karoo-contacts.csv":
    "647672cd5975a885874b699b24dea9eb5a9b698b429c073266eef117fb0ab815",
  "karoo-events.csv":
    "f0c973163cf874ba54a20f593d977ce509d6ef853bbc97843a607b727da2aa47",
  "kilele-campaigns.csv":
    "725486eb551eaf33c6dc0d34c382c935bd096e64359f08c8fe0c1e2cd82f08d9",
  "kilele-contacts-delta-2026-09-01.csv":
    "aa44d2f0eaff1adc93f2985eb8476a946afddc98596011f97c7804b88b151e9b",
  "kilele-contacts.csv":
    "7703f419119e0342deeef956cdf81fffbbfa7263559c8ccaef7a02872a3ef2c0",
  "kilele-events.csv":
    "f25d5f1850c4e68d741c63a8247e1252af2ca2aa24e431927d8e499794814232",
  "kilele-send-log.csv":
    "6f7a5f03437f9d90e6ac3719db8ebf4fc6bc6a9d89801f98db2785004e7c0ec2",
  "marrakech-campaigns.csv":
    "325784ff119ee6116970380320096d4561a384afb23a563c3359d88ef631f5ff",
  "marrakech-contacts.csv":
    "bf4549be8911fa0be26aa15a51bfcbde1e4abf3ff3896523adf283e865fcbf19",
  "marrakech-events.csv":
    "3c91b1adf2bbc56cbbc65463e4d5eea0ee00e9e72736b6a83bc377ec4e92d739",
};
