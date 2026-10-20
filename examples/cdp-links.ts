/** Five US pages and five German pages for manual/live CDP checks. */
export const CDP_LINKS = [
  {
    country: 'US',
    name: 'Apple Mac mini',
    url: 'https://www.apple.com/mac-mini/specs/',
    expected: /Mac mini/i,
  },
  {
    country: 'US',
    name: 'Microsoft Surface Laptop',
    url: 'https://www.microsoft.com/en-us/surface/devices/surface-laptop',
    expected: /Surface Laptop/i,
  },
  {
    country: 'US',
    name: 'Framework Laptop 13',
    url: 'https://frame.work/laptop13',
    expected: /Framework Laptop 13/i,
  },
  {
    country: 'US',
    name: 'Tesla Model 3',
    url: 'https://www.tesla.com/model3',
    expected: /Model 3/i,
  },
  {
    country: 'US',
    name: 'Apple MacBook Air',
    url: 'https://www.apple.com/macbook-air/specs/',
    expected: /MacBook Air/i,
  },
  {
    country: 'DE',
    name: 'Apple Mac mini (German)',
    url: 'https://www.apple.com/de/mac-mini/specs/',
    expected: /Mac mini/i,
  },
  {
    country: 'DE',
    name: 'Teufel ULTIMA 40',
    url: 'https://teufel.de/ultima-40-105781000',
    expected: /ULTIMA 40/i,
  },
  {
    country: 'DE',
    name: 'Tesla Model 3 (German)',
    url: 'https://www.tesla.com/de_de/model3',
    expected: /Model 3/i,
  },
  {
    country: 'DE',
    name: 'Apple MacBook Air (German)',
    url: 'https://www.apple.com/de/macbook-air/specs/',
    expected: /MacBook Air/i,
  },
  {
    country: 'DE',
    name: 'Microsoft Surface Laptop (German)',
    url: 'https://www.microsoft.com/de-de/surface/devices/surface-laptop',
    expected: /Surface Laptop/i,
  },
] as const;
