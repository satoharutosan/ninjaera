/**
 * Canonical country names aligned with the frontend COUNTRIES / COUNTRY_ISO map.
 * Registration stores these names so the profile <select> value always matches an option.
 */

const ISO_TO_NAME: Record<string, string> = {
  AF: "Afghanistan", AL: "Albania", DZ: "Algeria", AD: "Andorra", AO: "Angola",
  AG: "Antigua and Barbuda", AR: "Argentina", AM: "Armenia", AU: "Australia", AT: "Austria",
  AZ: "Azerbaijan", BS: "Bahamas", BH: "Bahrain", BD: "Bangladesh", BB: "Barbados",
  BY: "Belarus", BE: "Belgium", BZ: "Belize", BJ: "Benin", BT: "Bhutan",
  BO: "Bolivia", BA: "Bosnia and Herzegovina", BW: "Botswana", BR: "Brazil", BN: "Brunei",
  BG: "Bulgaria", BF: "Burkina Faso", BI: "Burundi", CV: "Cabo Verde", KH: "Cambodia",
  CM: "Cameroon", CA: "Canada", CF: "Central African Republic", TD: "Chad", CL: "Chile",
  CN: "China", CO: "Colombia", KM: "Comoros", CG: "Congo", CR: "Costa Rica",
  HR: "Croatia", CU: "Cuba", CY: "Cyprus", CZ: "Czech Republic", DK: "Denmark",
  DJ: "Djibouti", DM: "Dominica", DO: "Dominican Republic", EC: "Ecuador", EG: "Egypt",
  SV: "El Salvador", GQ: "Equatorial Guinea", ER: "Eritrea", EE: "Estonia", SZ: "Eswatini",
  ET: "Ethiopia", FJ: "Fiji", FI: "Finland", FR: "France", GA: "Gabon",
  GM: "Gambia", GE: "Georgia", DE: "Germany", GH: "Ghana", GR: "Greece",
  GD: "Grenada", GT: "Guatemala", GN: "Guinea", GW: "Guinea-Bissau", GY: "Guyana",
  HT: "Haiti", HN: "Honduras", HU: "Hungary", IS: "Iceland", IN: "India",
  ID: "Indonesia", IR: "Iran", IQ: "Iraq", IE: "Ireland", IL: "Israel",
  IT: "Italy", JM: "Jamaica", JP: "Japan", JO: "Jordan", KZ: "Kazakhstan",
  KE: "Kenya", KI: "Kiribati", KW: "Kuwait", KG: "Kyrgyzstan", LA: "Laos",
  LV: "Latvia", LB: "Lebanon", LS: "Lesotho", LR: "Liberia", LY: "Libya",
  LI: "Liechtenstein", LT: "Lithuania", LU: "Luxembourg", MG: "Madagascar", MW: "Malawi",
  MY: "Malaysia", MV: "Maldives", ML: "Mali", MT: "Malta", MH: "Marshall Islands",
  MR: "Mauritania", MU: "Mauritius", MX: "Mexico", FM: "Micronesia", MD: "Moldova",
  MC: "Monaco", MN: "Mongolia", ME: "Montenegro", MA: "Morocco", MZ: "Mozambique",
  MM: "Myanmar", NA: "Namibia", NR: "Nauru", NP: "Nepal", NL: "Netherlands",
  NZ: "New Zealand", NI: "Nicaragua", NE: "Niger", NG: "Nigeria", KP: "North Korea",
  MK: "North Macedonia", NO: "Norway", OM: "Oman", PK: "Pakistan", PW: "Palau",
  PS: "Palestine", PA: "Panama", PG: "Papua New Guinea", PY: "Paraguay", PE: "Peru",
  PH: "Philippines", PL: "Poland", PT: "Portugal", QA: "Qatar", RO: "Romania",
  RU: "Russia", RW: "Rwanda", KN: "Saint Kitts and Nevis", LC: "Saint Lucia",
  VC: "Saint Vincent and the Grenadines", WS: "Samoa", SM: "San Marino",
  SA: "Saudi Arabia", SN: "Senegal", RS: "Serbia", SC: "Seychelles", SL: "Sierra Leone",
  SG: "Singapore", SK: "Slovakia", SI: "Slovenia", SB: "Solomon Islands", SO: "Somalia",
  ZA: "South Africa", KR: "South Korea", SS: "South Sudan", ES: "Spain", LK: "Sri Lanka",
  SD: "Sudan", SE: "Sweden", CH: "Switzerland", SY: "Syria", TW: "Taiwan",
  TJ: "Tajikistan", TZ: "Tanzania", TH: "Thailand", TL: "Timor-Leste", TG: "Togo",
  TO: "Tonga", TT: "Trinidad and Tobago", TN: "Tunisia", TR: "Turkey", TM: "Turkmenistan",
  TV: "Tuvalu", UG: "Uganda", UA: "Ukraine", AE: "United Arab Emirates",
  GB: "United Kingdom", US: "United States", UY: "Uruguay", UZ: "Uzbekistan",
  VU: "Vanuatu", VA: "Vatican City", VE: "Venezuela", VN: "Vietnam", YE: "Yemen",
  ZM: "Zambia", ZW: "Zimbabwe", SR: "Suriname",
};

const NAME_ALIASES: Record<string, string> = {
  "holland": "Netherlands",
  "the netherlands": "Netherlands",
  "nederland": "Netherlands",
  "netherlands (kingdom of the)": "Netherlands",
  "usa": "United States",
  "us": "United States",
  "u.s.": "United States",
  "u.s.a.": "United States",
  "united states of america": "United States",
  "uk": "United Kingdom",
  "great britain": "United Kingdom",
  "britain": "United Kingdom",
  "england": "United Kingdom",
  "south korea": "South Korea",
  "korea, republic of": "South Korea",
  "republic of korea": "South Korea",
  "korea (republic of)": "South Korea",
  "north korea": "North Korea",
  "russia": "Russia",
  "russian federation": "Russia",
  "czechia": "Czech Republic",
  "czech republic": "Czech Republic",
  "viet nam": "Vietnam",
  "syria": "Syria",
  "syrian arab republic": "Syria",
  "taiwan, province of china": "Taiwan",
  "türkiye": "Turkey",
  "turkiye": "Turkey",
  "uae": "United Arab Emirates",
};

const CANONICAL_NAMES = new Set(Object.values(ISO_TO_NAME));

/**
 * Map any geo API name / ISO code to a canonical country name used by the UI selector.
 * Returns "Unknown" when unresolved — never invents Afghanistan/Japan.
 */
export function normalizeCountryName(raw: string | null | undefined, isoCode?: string | null): string {
  if (isoCode && /^[a-z]{2}$/i.test(isoCode.trim())) {
    const byIso = ISO_TO_NAME[isoCode.trim().toUpperCase()];
    if (byIso) return byIso;
  }

  const name = (raw || "").trim();
  if (!name) return "Unknown";
  const lower = name.toLowerCase();
  if (lower === "unknown" || lower === "n/a" || lower === "none") return "Unknown";

  if (/^[a-z]{2}$/i.test(name)) {
    const byIso = ISO_TO_NAME[name.toUpperCase()];
    if (byIso) return byIso;
  }

  if (CANONICAL_NAMES.has(name)) return name;

  const aliased = NAME_ALIASES[lower];
  if (aliased) return aliased;

  for (const canonical of CANONICAL_NAMES) {
    if (canonical.toLowerCase() === lower) return canonical;
  }

  return "Unknown";
}
