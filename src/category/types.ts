export type ContentKind =
  | 'item_detail'
  | 'item_collection'
  | 'editorial'
  | 'instructional'
  | 'policy_legal'
  | 'non_content';

export type FamilyId = 'goods' | 'digital' | 'service' | 'entity' | 'concept';

export type ArchetypeId =
  | 'packshot'
  | 'apparel_flat'
  | 'food_shot'
  | 'in_situ'
  | 'place_exterior'
  | 'abstract_hero'
  | 'editorial_concept'
  | 'none';

export type DomainId =
  | 'electronics'
  | 'home_appliance'
  | 'furniture_decor'
  | 'apparel_footwear'
  | 'jewelry_watches'
  | 'beauty_care'
  | 'food_beverage'
  | 'health_supplements'
  | 'tools_industrial'
  | 'vehicles_parts'
  | 'sports_outdoor_toys'
  | 'media_books'
  | 'software_app'
  | 'games_media'
  | 'plan_subscription'
  | 'travel_stay'
  | 'education_course'
  | 'event_ticket'
  | 'local_service'
  | 'real_estate'
  | 'organization_person'
  | 'job_listing'
  | 'news_analysis'
  | 'science_knowledge'
  | 'general';

export interface ArchetypeRecipe {
  id: ArchetypeId;
  intentLine: string;
  composition: string;
  light: string;
  background: string;
  realismLine: string;
  modifiers: string[];
  forbidden: string[];
  defaultSize: string;
}

export interface FamilyProfile {
  id: FamilyId;
  specHints: string[];
  visualSlots: string[];
}

export interface DomainProfile {
  domain: DomainId;
  family: FamilyId;
  subjectNoun: string;
  criteria: string;
  specHints: string[];
  archetype: ArchetypeId;
  defaultStyle: string;
  defaultSize: string;
  allowImage: boolean;
}

export interface ResolvedProfile extends DomainProfile {
  familySpecHints: string[];
  familyVisualSlots: string[];
  recipe: ArchetypeRecipe;
}

export type ScopeKind = 'single' | 'multiple' | 'none';
