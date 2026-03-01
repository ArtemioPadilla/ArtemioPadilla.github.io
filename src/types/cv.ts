export interface CVName {
  first: string;
  last: string;
  full: string;
}

export interface CVContact {
  phone?: string;
  email: string;
  linkedin?: string;
  github?: string;
  orcid?: string;
  twitter?: string;
  facebook?: string;
}

export interface CVSummary {
  brief: string;
  tagline?: string;
  full?: string;
  connection?: string;
  current?: string;
  strengths?: string[];
  closing?: string;
}

export interface CVPersonal {
  name: CVName;
  title: string;
  location: string;
  contact: CVContact;
  profileImage?: string;
  summary: CVSummary;
}

export interface HighlightMetrics {
  [key: string]: string | number | null;
}

export interface ExperienceHighlight {
  text: string;
  metrics?: HighlightMetrics;
  priority?: number;
}

export interface Experience {
  id: string;
  title: string;
  company: string;
  location?: string;
  startDate: string;
  endDate: string | null;
  current?: boolean;
  highlights: ExperienceHighlight[];
}

export interface Project {
  name: string;
  description?: string;
  url?: string;
  year: string;
  type?: string;
}

export interface Education {
  degree: string;
  institution: string;
  startDate?: string | null;
  endDate?: string | null;
  expectedEndDate?: string;
  gpa?: string | null;
  coursework?: string | null;
  achievement?: string | null;
}

export interface Certification {
  name: string;
  issuer?: string;
  date: string;
  url?: string;
  description?: string;
  credentialId?: string;
  expirationDate?: string;
  type?: string;
}

export interface Skills {
  languages: string[];
  cloudAndMLOps?: string[];
  databases?: {
    relational?: string[];
    nosql?: string[];
  };
  bigData?: string[];
  machineLearning?: string[];
  visualization?: string[];
  tools?: string[];
  design?: string[];
}

export interface LeadershipRole {
  role: string;
  organization: string;
  period: string;
  location?: string;
  highlights?: string[];
  description?: string;
}

export interface Publication {
  title: string;
  journal?: string;
  institution?: string;
  year: number | string;
  url?: string;
  type?: string;
  doi?: string;
}

export interface AwardCertificate {
  name: string;
  url?: string;
}

export interface Award {
  title: string;
  organization?: string;
  description?: string;
  year: number | string;
  certificates?: AwardCertificate[];
}

export interface Language {
  name: string;
  level: string;
  certifications?: { name: string; url?: string }[];
}

export interface Interests {
  professional?: string[];
  personal?: string[];
  philosophy?: string;
}

export interface CurrentEducation {
  degree: string;
  institution: string;
  progress: number;
  expectedCompletion: string;
}

export interface CurrentProject {
  name: string;
  description: string;
  technologies: string[];
}

export interface LearningTopic {
  topic: string;
  platform: string;
  icon: string;
}

export interface NextGoal {
  goal: string;
  targetDate: string;
}

export interface CurrentlyWorkingOn {
  education?: CurrentEducation;
  projects?: CurrentProject[];
  learning?: LearningTopic[];
  nextGoals?: NextGoal[];
}

export interface CVMetadata {
  version: string;
  lastUpdated: string;
  source?: string;
  templateOptions?: {
    formats?: Record<string, string>;
    resumeMaxItems?: Record<string, number>;
  };
}

export interface CVData {
  personal: CVPersonal;
  experience: Experience[];
  projects: Project[];
  education: Education[];
  certifications?: Certification[];
  skills: Skills;
  leadership?: LeadershipRole[];
  publications?: Publication[];
  awards?: Award[];
  languages?: Language[];
  interests?: Interests;
  currentlyWorkingOn?: CurrentlyWorkingOn;
  metadata: CVMetadata;
}

export type PDFFormat = "full" | "resume" | "summary";
