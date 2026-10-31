// Reference data for an Africa-first product.

/** All 54 African Union member states: ISO code, name, international dialling code. */
export const COUNTRIES: { code: string; name: string; dial: string }[] = [
  ["DZ", "Algeria", "213"], ["AO", "Angola", "244"], ["BJ", "Benin", "229"], ["BW", "Botswana", "267"],
  ["BF", "Burkina Faso", "226"], ["BI", "Burundi", "257"], ["CV", "Cabo Verde", "238"], ["CM", "Cameroon", "237"],
  ["CF", "Central African Republic", "236"], ["TD", "Chad", "235"], ["KM", "Comoros", "269"], ["CG", "Congo", "242"],
  ["CD", "DR Congo", "243"], ["CI", "Côte d'Ivoire", "225"], ["DJ", "Djibouti", "253"], ["EG", "Egypt", "20"],
  ["GQ", "Equatorial Guinea", "240"], ["ER", "Eritrea", "291"], ["SZ", "Eswatini", "268"], ["ET", "Ethiopia", "251"],
  ["GA", "Gabon", "241"], ["GM", "Gambia", "220"], ["GH", "Ghana", "233"], ["GN", "Guinea", "224"],
  ["GW", "Guinea-Bissau", "245"], ["KE", "Kenya", "254"], ["LS", "Lesotho", "266"], ["LR", "Liberia", "231"],
  ["LY", "Libya", "218"], ["MG", "Madagascar", "261"], ["MW", "Malawi", "265"], ["ML", "Mali", "223"],
  ["MR", "Mauritania", "222"], ["MU", "Mauritius", "230"], ["MA", "Morocco", "212"], ["MZ", "Mozambique", "258"],
  ["NA", "Namibia", "264"], ["NE", "Niger", "227"], ["NG", "Nigeria", "234"], ["RW", "Rwanda", "250"],
  ["ST", "São Tomé and Príncipe", "239"], ["SN", "Senegal", "221"], ["SC", "Seychelles", "248"], ["SL", "Sierra Leone", "232"],
  ["SO", "Somalia", "252"], ["ZA", "South Africa", "27"], ["SS", "South Sudan", "211"], ["SD", "Sudan", "249"],
  ["TZ", "Tanzania", "255"], ["TG", "Togo", "228"], ["TN", "Tunisia", "216"], ["UG", "Uganda", "256"],
  ["ZM", "Zambia", "260"], ["ZW", "Zimbabwe", "263"],
].map(([code, name, dial]) => ({ code, name, dial }));

export const countryName = (code: string | undefined | null) => COUNTRIES.find((c) => c.code === code)?.name ?? code ?? "";

/** Local number (e.g. 0712 345 678) → international digits for wa.me links. */
export function waNumber(phone: string | null, country = "KE"): string | null {
  if (!phone) return null;
  let d = phone.replace(/\D/g, "");
  const dial = COUNTRIES.find((c) => c.code === country)?.dial ?? "254";
  if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = dial + d.slice(1);
  else if (!d.startsWith(dial) && d.length <= 9) d = dial + d;
  return d.length >= 10 ? d : null;
}

export const ORG_KINDS: Record<string, string> = {
  ngo: "NGO or community programme",
  school: "School",
  university: "University or college",
  counselling_centre: "Counselling centre",
  private_practice: "Private practice",
  faith_based: "Faith-based organisation",
  government: "Government or county service",
  other: "Other",
};

export const ROLES: Record<string, { label: string; help: string }> = {
  owner: { label: "Owner", help: "Everything, including billing, team and settings." },
  admin: { label: "Administrator", help: "Manages the team, programmes and settings; sees all non-restricted cases." },
  supervisor: { label: "Clinical supervisor", help: "Sees their team's clients, co-signs notes and handles escalations." },
  counsellor: { label: "Counsellor", help: "Sees and documents their own clients." },
  lay_counsellor: { label: "Lay counsellor", help: "Like a counsellor, but every note is co-signed by their supervisor." },
  me_officer: { label: "M&E officer", help: "Sees anonymised programme reports only, never individual records." },
};

export const SERVICES: Record<string, string> = {
  medical: "Medical", psychiatric: "Psychiatric", legal: "Legal aid", protection: "Child protection",
  gbv: "GBV services", education: "Education", economic: "Economic support", social: "Social support", other: "Other",
};

export const REFERRAL_STATUS: Record<string, string> = {
  made: "Referred", accepted: "Accepted", attended: "Attended", not_attended: "Didn't attend", declined: "Declined", closed: "Closed",
};

export const GENDERS: Record<string, string> = { female: "Female", male: "Male", other: "Other", undisclosed: "Prefer not to say" };
