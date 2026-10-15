import { ARCHETYPE_RECIPES, FAMILY_PROFILES } from './archetypes.js';
import type { DomainId, DomainProfile, FamilyId, ResolvedProfile } from './types.js';

interface DomainSeed {
  domain: DomainId;
  family: FamilyId;
  subjectNoun: string;
  criteria: string;
  specHints: string[];
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
    archetype: 'abstract_hero',
    defaultStyle: 'simple neutral illustration',
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
    archetype: seed.archetype,
    defaultStyle: seed.defaultStyle,
    defaultSize: seed.defaultSize ?? recipe.defaultSize,
    allowImage: seed.allowImage,
  };
}

const BUILTINS: Record<DomainId, DomainProfile> = Object.fromEntries(
  SEEDS.map((seed) => [seed.domain, seedToProfile(seed)]),
) as Record<DomainId, DomainProfile>;

const overrides = new Map<DomainId, Partial<DomainProfile>>();

export function registerCategory(domain: DomainId, patch: Partial<DomainProfile>): void {
  overrides.set(domain, { ...(overrides.get(domain) ?? {}), ...patch });
}

export function resetCategoryOverrides(): void {
  overrides.clear();
}

export function getDomainProfile(domain: DomainId): DomainProfile {
  const base = BUILTINS[domain] ?? BUILTINS.general;
  const patch = overrides.get(domain);
  if (!patch) return base;
  return { ...base, ...patch, domain: base.domain, family: patch.family ?? base.family };
}

export function listDomains(): DomainId[] {
  return Object.keys(BUILTINS) as DomainId[];
}

export function resolveProfile(domain: DomainId): ResolvedProfile {
  const profile = getDomainProfile(domain);
  const family = FAMILY_PROFILES[profile.family];
  return {
    ...profile,
    familySpecHints: family.specHints,
    familyVisualSlots: family.visualSlots,
    recipe: ARCHETYPE_RECIPES[profile.archetype],
  };
}

export function familyOf(domain: DomainId): FamilyId {
  return getDomainProfile(domain).family;
}
