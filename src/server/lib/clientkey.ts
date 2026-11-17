/** Schlüssel für die Begrenzung: IPv4 wie sie ist, IPv6 auf das /64-Netz gekürzt */
export function clientKey(ip: string | undefined): string {
  const x = (ip ?? '').trim();
  if (!x.includes(':')) return x;
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(x)) return x.slice(7);
  const [head = '', tail = ''] = x.split('::');
  const h = head ? head.split(':') : [], t = x.includes('::') ? (tail ? tail.split(':') : []) : [];
  const full = x.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return full.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64';
}
