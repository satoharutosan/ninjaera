// ISO 3166-1 alpha-2 codes for all supported countries
export const COUNTRY_ISO: Record<string, string> = {
  "Afghanistan": "AF", "Albania": "AL", "Algeria": "DZ", "Andorra": "AD", "Angola": "AO",
  "Antigua and Barbuda": "AG", "Argentina": "AR", "Armenia": "AM", "Australia": "AU", "Austria": "AT",
  "Azerbaijan": "AZ", "Bahamas": "BS", "Bahrain": "BH", "Bangladesh": "BD", "Barbados": "BB",
  "Belarus": "BY", "Belgium": "BE", "Belize": "BZ", "Benin": "BJ", "Bhutan": "BT",
  "Bolivia": "BO", "Bosnia and Herzegovina": "BA", "Botswana": "BW", "Brazil": "BR", "Brunei": "BN",
  "Bulgaria": "BG", "Burkina Faso": "BF", "Burundi": "BI", "Cabo Verde": "CV", "Cambodia": "KH",
  "Cameroon": "CM", "Canada": "CA", "Central African Republic": "CF", "Chad": "TD", "Chile": "CL",
  "China": "CN", "Colombia": "CO", "Comoros": "KM", "Congo": "CG", "Costa Rica": "CR",
  "Croatia": "HR", "Cuba": "CU", "Cyprus": "CY", "Czech Republic": "CZ", "Denmark": "DK",
  "Djibouti": "DJ", "Dominica": "DM", "Dominican Republic": "DO", "Ecuador": "EC", "Egypt": "EG",
  "El Salvador": "SV", "Equatorial Guinea": "GQ", "Eritrea": "ER", "Estonia": "EE", "Eswatini": "SZ",
  "Ethiopia": "ET", "Fiji": "FJ", "Finland": "FI", "France": "FR", "Gabon": "GA",
  "Gambia": "GM", "Georgia": "GE", "Germany": "DE", "Ghana": "GH", "Greece": "GR",
  "Grenada": "GD", "Guatemala": "GT", "Guinea": "GN", "Guinea-Bissau": "GW", "Guyana": "GY",
  "Haiti": "HT", "Honduras": "HN", "Hungary": "HU", "Iceland": "IS", "India": "IN",
  "Indonesia": "ID", "Iran": "IR", "Iraq": "IQ", "Ireland": "IE", "Israel": "IL",
  "Italy": "IT", "Jamaica": "JM", "Japan": "JP", "Jordan": "JO", "Kazakhstan": "KZ",
  "Kenya": "KE", "Kiribati": "KI", "Kuwait": "KW", "Kyrgyzstan": "KG", "Laos": "LA",
  "Latvia": "LV", "Lebanon": "LB", "Lesotho": "LS", "Liberia": "LR", "Libya": "LY",
  "Liechtenstein": "LI", "Lithuania": "LT", "Luxembourg": "LU", "Madagascar": "MG", "Malawi": "MW",
  "Malaysia": "MY", "Maldives": "MV", "Mali": "ML", "Malta": "MT", "Marshall Islands": "MH",
  "Mauritania": "MR", "Mauritius": "MU", "Mexico": "MX", "Micronesia": "FM", "Moldova": "MD",
  "Monaco": "MC", "Mongolia": "MN", "Montenegro": "ME", "Morocco": "MA", "Mozambique": "MZ",
  "Myanmar": "MM", "Namibia": "NA", "Nauru": "NR", "Nepal": "NP", "Netherlands": "NL",
  "New Zealand": "NZ", "Nicaragua": "NI", "Niger": "NE", "Nigeria": "NG", "North Korea": "KP",
  "North Macedonia": "MK", "Norway": "NO", "Oman": "OM", "Pakistan": "PK", "Palau": "PW",
  "Palestine": "PS", "Panama": "PA", "Papua New Guinea": "PG", "Paraguay": "PY", "Peru": "PE",
  "Philippines": "PH", "Poland": "PL", "Portugal": "PT", "Qatar": "QA", "Romania": "RO",
  "Russia": "RU", "Rwanda": "RW", "Saint Kitts and Nevis": "KN", "Saint Lucia": "LC",
  "Saint Vincent and the Grenadines": "VC", "Samoa": "WS", "San Marino": "SM",
  "Saudi Arabia": "SA", "Senegal": "SN", "Serbia": "RS", "Seychelles": "SC", "Sierra Leone": "SL",
  "Singapore": "SG", "Slovakia": "SK", "Slovenia": "SI", "Solomon Islands": "SB", "Somalia": "SO",
  "South Africa": "ZA", "South Korea": "KR", "South Sudan": "SS", "Spain": "ES", "Sri Lanka": "LK",
  "Sudan": "SD", "Sweden": "SE", "Switzerland": "CH", "Syria": "SY", "Taiwan": "TW",
  "Tajikistan": "TJ", "Tanzania": "TZ", "Thailand": "TH", "Timor-Leste": "TL", "Togo": "TG",
  "Tonga": "TO", "Trinidad and Tobago": "TT", "Tunisia": "TN", "Turkey": "TR", "Turkmenistan": "TM",
  "Tuvalu": "TV", "Uganda": "UG", "Ukraine": "UA", "United Arab Emirates": "AE",
  "United Kingdom": "GB", "United States": "US", "Uruguay": "UY", "Uzbekistan": "UZ",
  "Vanuatu": "VU", "Vatican City": "VA", "Venezuela": "VE", "Vietnam": "VN", "Yemen": "YE",
  "Zambia": "ZM", "Zimbabwe": "ZW",
  "Suriname": "SR",
};

/** Alternate names / spellings → canonical COUNTRY_ISO keys. */
const COUNTRY_ALIASES: Record<string, string> = {
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
  "korea, democratic people's republic of": "North Korea",
  "russia": "Russia",
  "russian federation": "Russia",
  "czechia": "Czech Republic",
  "czech republic": "Czech Republic",
  "viet nam": "Vietnam",
  "syria": "Syria",
  "syrian arab republic": "Syria",
  "taiwan, province of china": "Taiwan",
  "taiwan (province of china)": "Taiwan",
  "republic of china": "Taiwan",
  "uae": "United Arab Emirates",
  "brunei darussalam": "Brunei",
  "laos": "Laos",
  "lao people's democratic republic": "Laos",
  "moldova, republic of": "Moldova",
  "republic of moldova": "Moldova",
  "tanzania, united republic of": "Tanzania",
  "united republic of tanzania": "Tanzania",
  "bolivia (plurinational state of)": "Bolivia",
  "venezuela (bolivarian republic of)": "Venezuela",
  "iran (islamic republic of)": "Iran",
  "palestine, state of": "Palestine",
  "state of palestine": "Palestine",
};

/**
 * Resolve any country name, alias, or ISO alpha-2 code to a lowercase flagcdn ISO code.
 * Returns null for Unknown / unrecognized values.
 */
export function resolveCountryIso(country: string | null | undefined): string | null {
  if (!country) return null;
  const raw = country.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower === "unknown" || lower === "n/a" || lower === "none") return null;

  // Already an ISO alpha-2 code (e.g. "NL", "nl")
  if (/^[a-z]{2}$/i.test(raw)) return raw.toLowerCase();

  if (COUNTRY_ISO[raw]) return COUNTRY_ISO[raw].toLowerCase();

  const aliased = COUNTRY_ALIASES[lower];
  if (aliased && COUNTRY_ISO[aliased]) return COUNTRY_ISO[aliased].toLowerCase();

  for (const [name, code] of Object.entries(COUNTRY_ISO)) {
    if (name.toLowerCase() === lower) return code.toLowerCase();
  }
  return null;
}

export function countryFlagEmoji(code: string): string {
  if (!code || code.length !== 2) return "🌐";
  return String.fromCodePoint(...code.toUpperCase().split("").map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

export function formatCountryDisplay(countryName: string | null, countryCode: string | null): string {
  const code = (countryCode && countryCode.length === 2 ? countryCode.toUpperCase() : null)
    || (countryName ? resolveCountryIso(countryName)?.toUpperCase() ?? null : null)
    || (countryName ? COUNTRY_ISO[countryName] : null)
    || null;
  const name = countryName || "Unknown";
  const flag = code ? countryFlagEmoji(code) : "🌐";
  return `${flag} ${name}`;
}

export function maskIp(ip: string | null): string {
  if (!ip) return "—";
  const parts = ip.split(".");
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.xxx.xxx`;
  return ip.slice(0, Math.min(ip.length, 8)) + "…";
}
