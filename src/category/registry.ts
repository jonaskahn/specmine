import { ARCHETYPE_RECIPES, FAMILY_PROFILES } from './archetypes.js';
import type {
  DomainId,
  DomainProfile,
  FamilyId,
  ResolvedProfile,
  SlotKeyMap,
  VisualSlot,
} from './types.js';

interface DomainSeed {
  domain: DomainId;
  family: FamilyId;
  subjectNoun: string;
  criteria: string;
  specHints: string[];
  specIgnore: string[];
  visualSlots?: string[];
  notDepictable: string[];
  minFacts: number;
  keyMapAdd?: Partial<SlotKeyMap>;
  archetype: ResolvedProfile['recipe']['id'];
  defaultStyle: string;
  defaultSize?: string;
  allowImage: boolean;
}

const SEEDS: DomainSeed[] = [
  {
    domain: 'electronics',
    family: 'goods',
    subjectNoun: 'product',
    criteria: 'A physical electronic device, component, or accessory — not software',
    specHints: ['power', 'connectivity', 'ports', 'resolution', 'battery', 'compatibility'],
    specIgnore: ['reviews', 'bundle offers', 'shipping info'],
    notDepictable: ['power', 'capacity', 'battery life', 'connectivity', 'ports'],
    minFacts: 2,
    archetype: 'packshot',
    defaultStyle: 'studio product photo',
    allowImage: true,
  },
  {
    domain: 'home_appliance',
    family: 'goods',
    subjectNoun: 'product',
    criteria: 'A kitchen, cleaning, or climate appliance for the home',
    specHints: ['power', 'capacity', 'programs', 'energy rating'],
    specIgnore: ['recipes', 'user reviews'],
    notDepictable: ['power', 'capacity', 'programs', 'energy rating'],
    minFacts: 2,
    archetype: 'packshot',
    defaultStyle: 'studio product photo',
    allowImage: true,
  },
  {
    domain: 'furniture_decor',
    family: 'goods',
    subjectNoun: 'product',
    criteria: 'Furniture, lighting, or home decor item',
    specHints: ['dimensions', 'material', 'assembly', 'room'],
    specIgnore: ['assembly instructions', 'delivery options'],
    notDepictable: ['dimensions', 'assembly steps', 'weight'],
    minFacts: 3,
    archetype: 'in_situ',
    defaultStyle: 'product in a styled room',
    allowImage: true,
  },
  {
    domain: 'apparel_footwear',
    family: 'goods',
    subjectNoun: 'product',
    criteria: 'Clothing, shoes, bags, or fashion accessories',
    specHints: ['sizes', 'fit', 'fabric composition', 'care', 'gender'],
    specIgnore: ['size chart tables', 'model measurements', 'size worn notes'],
    notDepictable: ['size', 'fit tables', 'care instructions', 'gender'],
    minFacts: 2,
    archetype: 'apparel_flat',
    defaultStyle: 'fashion flat lay',
    allowImage: true,
  },
  {
    domain: 'jewelry_watches',
    family: 'goods',
    subjectNoun: 'product',
    criteria: 'Jewelry, watches, or luxury small goods',
    specHints: ['material', 'carat', 'movement', 'dimensions'],
    specIgnore: ['certification documents'],
    notDepictable: ['carat', 'movement', 'water resistance', 'dimensions'],
    minFacts: 2,
    archetype: 'packshot',
    defaultStyle: 'luxury macro studio photo',
    allowImage: true,
  },
  {
    domain: 'beauty_care',
    family: 'goods',
    subjectNoun: 'product',
    criteria: 'Cosmetics, skincare, or personal hygiene product',
    specHints: ['volume', 'ingredients', 'skin type', 'usage'],
    specIgnore: ['reviews', 'shade finder quizzes'],
    notDepictable: ['volume', 'ingredients', 'skin type', 'usage instructions'],
    minFacts: 2,
    archetype: 'packshot',
    defaultStyle: 'clean beauty studio photo',
    allowImage: true,
  },
  {
    domain: 'food_beverage',
    family: 'goods',
    subjectNoun: 'product',
    criteria: 'Grocery, drinks, or prepared dishes',
    specHints: [
      'ingredients',
      'allergens',
      'net weight or volume',
      'nutrition',
      'storage',
      'origin',
    ],
    specIgnore: ['recipes', 'serving suggestions'],
    notDepictable: ['nutrition', 'allergens', 'net weight', 'storage instructions'],
    minFacts: 2,
    archetype: 'food_shot',
    defaultStyle: 'appetizing food photo',
    allowImage: true,
  },
  {
    domain: 'health_supplements',
    family: 'goods',
    subjectNoun: 'product',
    criteria: 'Medicine, vitamins, supplements, or medical devices — no treatment claims implied',
    specHints: ['active ingredients', 'dosage form', 'strength', 'pack size'],
    specIgnore: ['dosage instructions', 'medical disclaimers'],
    notDepictable: ['dosage', 'strength', 'health claims'],
    minFacts: 2,
    archetype: 'packshot',
    defaultStyle: 'neutral pharmacy packshot',
    allowImage: true,
  },
  {
    domain: 'tools_industrial',
    family: 'goods',
    subjectNoun: 'product',
    criteria: 'Tools, machinery, or industrial parts and materials',
    specHints: ['power', 'dimensions', 'duty rating', 'compatibility'],
    specIgnore: ['safety manuals', 'compatibility tables'],
    notDepictable: ['power ratings', 'duty rating', 'compatibility'],
    minFacts: 2,
    archetype: 'packshot',
    defaultStyle: 'industrial catalog photo',
    allowImage: true,
  },
  {
    domain: 'vehicles_parts',
    family: 'goods',
    subjectNoun: 'product',
    criteria: 'Vehicles or spare parts',
    specHints: ['year', 'engine', 'fuel', 'mileage', 'fitment or part number'],
    specIgnore: ['financing offers', 'dealer contact blocks'],
    notDepictable: ['engine specs', 'mileage', 'VIN', 'fuel consumption', 'price'],
    minFacts: 3,
    archetype: 'in_situ',
    defaultStyle: 'vehicle in a clean outdoor setting',
    allowImage: true,
  },
  {
    domain: 'sports_outdoor_toys',
    family: 'goods',
    subjectNoun: 'product',
    criteria: 'Sports gear, outdoor equipment, toys, or baby products',
    specHints: ['size', 'age range', 'material', 'safety'],
    specIgnore: ['safety warning boilerplate'],
    notDepictable: ['size', 'age range', 'weight limit'],
    minFacts: 2,
    archetype: 'in_situ',
    defaultStyle: 'product in active use setting',
    allowImage: true,
  },
  {
    domain: 'media_books',
    family: 'goods',
    subjectNoun: 'product',
    criteria: 'Physical books, music media, or collectibles',
    specHints: ['author or artist', 'format', 'pages or duration', 'publisher', 'ISBN'],
    specIgnore: ['reviews', 'author biography'],
    notDepictable: ['page count', 'duration', 'ISBN', 'publisher'],
    minFacts: 2,
    archetype: 'packshot',
    defaultStyle: 'catalog photo on neutral background',
    allowImage: true,
  },
  {
    domain: 'software_app',
    family: 'digital',
    subjectNoun: 'software',
    criteria: 'Software, SaaS, apps, APIs, or developer tools — not a physical device',
    specHints: [],
    specIgnore: ['pricing tables', 'changelog'],
    visualSlots: ['subject', 'colors', 'setting', 'mood'],
    notDepictable: ['version', 'feature lists', 'screenshots', 'UI details'],
    minFacts: 2,
    archetype: 'abstract_hero',
    defaultStyle: 'abstract tech hero art',
    allowImage: true,
  },
  {
    domain: 'games_media',
    family: 'digital',
    subjectNoun: 'title',
    criteria: 'Video games, streaming, or digital media content',
    specHints: ['platform', 'genre', 'release date', 'rating'],
    specIgnore: ['system requirement tables', 'reviews'],
    visualSlots: ['subject', 'colors', 'setting', 'mood'],
    notDepictable: ['platform', 'release date', 'age rating'],
    minFacts: 2,
    archetype: 'abstract_hero',
    defaultStyle: 'cinematic key art without text',
    allowImage: true,
  },
  {
    domain: 'plan_subscription',
    family: 'service',
    subjectNoun: 'plan',
    criteria: 'Telecom, insurance, banking, or utility plans and subscriptions',
    specHints: [],
    specIgnore: ['legal terms', 'comparison tables'],
    notDepictable: ['price', 'billing period', 'contract terms'],
    minFacts: 2,
    archetype: 'abstract_hero',
    defaultStyle: 'clean trustworthy abstract art',
    allowImage: true,
  },
  {
    domain: 'travel_stay',
    family: 'service',
    subjectNoun: 'stay',
    criteria: 'Hotels, flights, tours, or travel experiences',
    specHints: ['dates', 'location', 'amenities', 'cancellation'],
    specIgnore: ['booking widgets', 'cancellation policy'],
    notDepictable: ['price', 'dates', 'cancellation terms'],
    minFacts: 2,
    archetype: 'place_exterior',
    defaultStyle: 'bright hospitality photo',
    allowImage: true,
  },
  {
    domain: 'education_course',
    family: 'service',
    subjectNoun: 'course',
    criteria: 'Courses, training, or educational programs',
    specHints: ['duration', 'level', 'format', 'price'],
    specIgnore: ['curriculum tables', 'instructor biographies'],
    notDepictable: ['duration', 'price', 'skill level'],
    minFacts: 2,
    archetype: 'abstract_hero',
    defaultStyle: 'friendly learning illustration',
    allowImage: true,
  },
  {
    domain: 'event_ticket',
    family: 'service',
    subjectNoun: 'event',
    criteria: 'Concerts, conferences, or ticketed events',
    specHints: ['date', 'venue', 'lineup', 'price tiers'],
    specIgnore: ['seating charts', 'refund policy'],
    notDepictable: ['date', 'price tiers', 'performer names'],
    minFacts: 2,
    archetype: 'place_exterior',
    defaultStyle: 'venue atmosphere photo',
    allowImage: true,
  },
  {
    domain: 'local_service',
    family: 'service',
    subjectNoun: 'service',
    criteria: 'Local repair, clinics, agencies, or personal services',
    specHints: [],
    specIgnore: ['testimonials', 'service area lists'],
    notDepictable: ['price', 'phone number', 'opening hours'],
    minFacts: 2,
    archetype: 'abstract_hero',
    defaultStyle: 'welcoming local business art',
    allowImage: true,
  },
  {
    domain: 'real_estate',
    family: 'entity',
    subjectNoun: 'property',
    criteria: 'Property for sale or rent',
    specHints: ['type', 'area', 'rooms', 'floor', 'year built', 'location', 'amenities'],
    specIgnore: ['agent contact blocks', 'mortgage calculators'],
    notDepictable: ['price', 'floor area', 'agent info'],
    minFacts: 3,
    keyMapAdd: { subject: ['property', 'address'] },
    archetype: 'place_exterior',
    defaultStyle: 'daylight property photo',
    allowImage: true,
  },
  {
    domain: 'organization_person',
    family: 'entity',
    subjectNoun: 'profile',
    criteria: 'Company, brand, or person profile — no generated likenesses',
    specHints: [],
    specIgnore: ['navigation', 'social media feeds'],
    notDepictable: ['contact details', 'company history'],
    minFacts: 2,
    archetype: 'none',
    defaultStyle: '',
    allowImage: false,
  },
  {
    domain: 'job_listing',
    family: 'entity',
    subjectNoun: 'role',
    criteria: 'Job postings or open roles',
    specHints: ['title', 'location', 'employment type', 'salary range', 'requirements'],
    specIgnore: ['company boilerplate', 'about us sections', 'benefits prose'],
    notDepictable: ['salary', 'requirements', 'contact details'],
    minFacts: 2,
    archetype: 'none',
    defaultStyle: '',
    allowImage: false,
  },
  {
    domain: 'news_analysis',
    family: 'concept',
    subjectNoun: 'article',
    criteria: 'News, finance, politics, or opinion pieces about real events',
    specHints: [],
    specIgnore: ['related articles', 'share bars', 'comment sections'],
    notDepictable: ['named people', 'real events', 'dates'],
    minFacts: 2,
    archetype: 'editorial_concept',
    defaultStyle: 'neutral editorial illustration',
    allowImage: true,
  },
  {
    domain: 'science_knowledge',
    family: 'concept',
    subjectNoun: 'article',
    criteria: 'Research, explainers, or educational knowledge content',
    specHints: [],
    specIgnore: ['reference lists', 'author biographies'],
    notDepictable: ['equations', 'raw data tables'],
    minFacts: 2,
    archetype: 'editorial_concept',
    defaultStyle: 'clear explanatory illustration',
    allowImage: true,
  },
  {
    domain: 'general',
    family: 'concept',
    subjectNoun: 'subject',
    criteria: 'Anything that does not fit the other categories',
    specHints: [],
    specIgnore: [],
    notDepictable: [],
    minFacts: 2,
    archetype: 'generic_subject',
    defaultStyle: 'neutral studio photo on plain background',
    allowImage: true,
  },
];

function seedToProfile(seed: DomainSeed): DomainProfile {
  const recipe = ARCHETYPE_RECIPES[seed.archetype];
  return {
    domain: seed.domain,
    family: seed.family,
    subjectNoun: seed.subjectNoun,
    criteria: seed.criteria,
    specHints: seed.specHints,
    specIgnore: seed.specIgnore,
    visualSlots: seed.visualSlots ?? [],
    notDepictable: seed.notDepictable,
    minFacts: seed.minFacts,
    ...(seed.keyMapAdd !== undefined ? { keyMapAdd: seed.keyMapAdd } : {}),
    archetype: seed.archetype,
    defaultStyle: seed.defaultStyle,
    defaultSize: seed.defaultSize ?? recipe.defaultSize,
    allowImage: seed.allowImage,
  };
}

const BUILTINS: Record<DomainId, DomainProfile> = Object.fromEntries(
  SEEDS.map((seed) => [seed.domain, seedToProfile(seed)]),
) as Record<DomainId, DomainProfile>;

const customs = new Map<DomainId, DomainProfile>();

export function registerCategory(domain: DomainId, patch: Partial<DomainProfile>): void {
  const base = customs.get(domain) ?? BUILTINS[domain] ?? BUILTINS.general;
  customs.set(domain, { ...base, ...patch, domain, family: patch.family ?? base.family });
}

export function resetCategoryOverrides(): void {
  customs.clear();
}

export function getDomainProfile(domain: DomainId): DomainProfile {
  return customs.get(domain) ?? BUILTINS[domain] ?? BUILTINS.general;
}

export function listDomains(): DomainId[] {
  return [...Object.keys(BUILTINS), ...customs.keys()] as DomainId[];
}

function mergeKeyMap(family: SlotKeyMap, add: Partial<SlotKeyMap> | undefined): SlotKeyMap {
  if (!add) return family;
  const merged = { ...family };
  for (const slot of Object.keys(add) as VisualSlot[]) {
    const extra = add[slot];
    if (extra) merged[slot] = [...new Set([...merged[slot], ...extra])];
  }
  return merged;
}

export function resolveProfile(domain: DomainId): ResolvedProfile {
  const profile = getDomainProfile(domain);
  const family = FAMILY_PROFILES[profile.family];
  return {
    ...profile,
    visualSlots: profile.visualSlots.length > 0 ? profile.visualSlots : family.visualSlots,
    familySpecHints: family.specHints,
    familyVisualSlots: family.visualSlots,
    keyMap: mergeKeyMap(family.keyMap, profile.keyMapAdd),
    recipe: ARCHETYPE_RECIPES[profile.archetype],
  };
}

export function familyOf(domain: DomainId): FamilyId {
  return getDomainProfile(domain).family;
}
