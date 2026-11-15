/**
 * Geräte im Hausnetz einordnen: Aus dem Namen, mit dem sich ein Gerät im Netz meldet, wird geschätzt, was es vermutlich ist.
 * Reine Mustererkennung auf diesem Rechner – es wird nichts ins Internet gesendet. Die Einschätzung ist eine Vermutung;
 * verbindlich ist nur, was der Administrator selbst festlegt.
 */
export const DEVICE_KINDS = {
  phone: 'Handy', tablet: 'Tablet', computer: 'Computer', printer: 'Drucker', bon: 'Bondrucker', terminal: 'EC-Gerät', tv: 'Fernseher',
  media: 'Lautsprecher / Streaming', router: 'Router / WLAN-Verstärker', server: 'Server / Netzwerkspeicher', camera: 'Kamera', smarthome: 'Smart-Home-Gerät',
  console: 'Spielkonsole', voip: 'Telefon (IP)', watch: 'Uhr', other: 'Sonstiges',
} as const;
export type DeviceKind = keyof typeof DEVICE_KINDS;
export const isDeviceKind = (k: string): k is DeviceKind => k in DEVICE_KINDS;

export interface DeviceRule { contains: string; kind: DeviceKind }
export interface DeviceGuess {
  kind: DeviceKind | null; label: string;
  /** set = vom Administrator festgelegt, rule = eigene Regel, name = aus dem Namen erkannt, hint = nur ein Anhaltspunkt, none = unbekannt */
  basis: 'set' | 'rule' | 'name' | 'hint' | 'none';
  reason: string;
}

const PATTERNS: [RegExp, DeviceKind, string?][] = [
  [/fritz\.?box|fritz\.?repeater|fritz\.?powerline|speedport|easybox|repeater|\bap[-_ ]|access[-_ ]?point|unifi|ubnt|tp-?link|netgear|devolo|mesh|router|gateway/, 'router'],
  [/tm-[tmpu]\d|tm[tm]\d{2}|bondrucker|star[-_ ]?(tsp|mc)|\btsp\d|bixolon|srp-/, 'bon'],
  [/ingenico|verifone|\bccv\b|pax[-_ ]|zvt|ec-?terminal|ec-?ger|kartenterminal|worldline|\byomani|\bvx\d{3}|\bdesk[-_ ]?\d{4}|\bmove[-_ ]?\d{4}/, 'terminal'],
  [/ipad/, 'tablet'], [/galaxy[-_ ]?tab|\btab[-_ ]?[as]\d|lenovo[-_ ]?tab|fire[-_ ]?hd|kindle|mediapad|matepad|surface[-_ ]?go|tablet/, 'tablet'],
  [/iphone/, 'phone'], [/galaxy|\bsm-[a-z]\d|android|pixel[-_ ]?\d|huawei|honor|xiaomi|redmi|\bpoco|oneplus|oppo|\bvivo|motorola|\bmoto[-_ ]|nokia|fairphone|handy|phone/, 'phone'],
  [/apple[-_ ]?watch|\bwatch|garmin|fitbit/, 'watch'],
  [/macbook|imac|mac[-_ ]?mini|mac[-_ ]?pro|mac[-_ ]?studio|desktop-|laptop-|\bpc[-_ ]|[-_ ]pc\b|thinkpad|notebook|latitude|optiplex|elitebook|probook|workstation|surface|\bwin(dows)?[-_ ]?\d|ubuntu|debian|kasse|rezeption/, 'computer'],
  [/\bnpi[0-9a-f]{4,}|laserjet|officejet|deskjet|\benvy|\bhp[0-9a-f]{6}|brother|\bbrn[0-9a-f]{6}|\bbrw[0-9a-f]{6}|canon|pixma|i-sensys|epson|\bet-\d|\bwf-\d|\bxp-\d|kyocera|ecosys|lexmark|ricoh|xerox|konica|oki[-_ ]|drucker|printer/, 'printer'],
  [/bravia|\blg[-_ ]?web ?os|webos|\[lg\]|samsung[-_ ]?tv|\[tv\]|\btv\b|philips[-_ ]?tv|panasonic|viera|hisense|\btcl|fernseh|android[-_ ]?tv|shield/, 'tv'],
  [/sonos|chromecast|google[-_ ]?(home|nest)|nest[-_ ]?(mini|hub|audio)|\becho|amazon-|fire[-_ ]?tv|firetv|apple[-_ ]?tv|homepod|\broku|\bbose|denon|\bheos|yamaha|marantz|spotify|airplay|teufel|receiver/, 'media'],
  [/playstation|\bps[345]\b|xbox|nintendo|switch/, 'console'],
  [/synology|diskstation|qnap|\bnas\b|mycloud|wdmycloud|server|proxmox|esxi|raspberrypi|raspberry|\bpi\d?\b|homeassistant|home-assistant/, 'server'],
  [/\bcam\b|camera|kamera|ipcam|hikvision|dahua|reolink|\bring[-_ ]|doorbell|arlo|\beufy|instar|axis-/, 'camera'],
  [/shelly|tasmota|\besp[-_ ]?[0-9a-f]{4,}|espressif|sonoff|\btuya|\bhue\b|philips-hue|tradfri|homematic|\bccu\d|netatmo|tado|bosch-|thermostat|steckdose|\bplug|smartthings|dect|wallbox|wechselrichter|solar|\bsma\d|fronius|kostal/, 'smarthome'],
  [/gigaset|snom|yealink|grandstream|\bsip[-_ ]|voip|telefon|fritz\.?fon|auerswald|agfeo/, 'voip'],
];

/** Schätzt die Art eines Geräts. `names` sind alle bekannten Namen (Netzname, Name in der FRITZ!Box, eigener Name). */
export function guessDevice(d: { names: string[]; kind?: string; randomMac?: boolean; self?: boolean; gateway?: boolean; wlan?: boolean | null }, rules: DeviceRule[] = []): DeviceGuess {
  const made = (kind: DeviceKind, basis: DeviceGuess['basis'], reason: string): DeviceGuess => ({ kind, label: DEVICE_KINDS[kind], basis, reason });
  if (d.kind && isDeviceKind(d.kind)) return made(d.kind, 'set', 'von Ihnen festgelegt');
  const names = d.names.map((n) => n.trim()).filter(Boolean);
  const low = names.join(' | ').toLowerCase();
  for (const r of rules) if (r.contains.trim() && low.includes(r.contains.trim().toLowerCase())) return made(r.kind, 'rule', `eigene Regel: Name enthält „${r.contains.trim()}“`);
  if (d.self) return made('computer', 'name', 'dieser Rechner');
  if (d.gateway) return made('router', 'name', 'über dieses Gerät geht es ins Internet');
  for (const [re, kind] of PATTERNS) {
    const m = re.exec(low);
    if (m) return made(kind, 'name', `Name enthält „${m[0].trim()}“`);
  }
  if (d.randomMac) return made('phone', 'hint', 'private (zufällige) Geräteadresse – so melden sich fast nur Handys und Tablets');
  return { kind: null, label: 'unbekannt', basis: 'none', reason: names.length ? 'der Name lässt keine Einordnung zu' : 'das Gerät nennt im Netz keinen Namen' };
}
