function isPrivateIpv4(hostname) {
  const octets = hostname.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  return octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || (octets[0] === 169 && octets[1] === 254)
    || octets[0] === 0;
}

export function getPublicShareUrl(locationLike) {
  let url;
  try {
    url = new URL(locationLike.href);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  const normalizedHost = hostname.replace(/^\[|\]$/g, '');
  const isLocalDomain = hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
    || hostname.endsWith('.test');
  const isPrivateIpv6 = normalizedHost === '::'
    || normalizedHost === '::1'
    || /^(fc|fd|fe[89ab])/i.test(normalizedHost)
    || (normalizedHost.startsWith('::ffff:') && isPrivateIpv4(normalizedHost.slice(7)));
  if (url.protocol !== 'https:' || isLocalDomain || isPrivateIpv4(hostname) || isPrivateIpv6) return null;
  return `${url.origin}/`;
}
