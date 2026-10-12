import {
  Activity, Ambulance, Award, Baby, BadgeCheck, Bed, Bone, Brain, Building2, CalendarCheck, CalendarDays, Car, ClipboardCheck,
  ClipboardList, Clock, Coffee, CreditCard, Cross, Dna, Droplet, Droplets, Ear, Eye, FileCheck2, FileText, FlaskConical, Flower2,
  Globe2, GraduationCap, HandHeart, HeartHandshake, HeartPulse, House, Leaf, Lightbulb, MapPin, Microscope, MonitorDot, Phone,
  Pill, Radiation, ScanLine, ShieldCheck, Siren, Smile, Sparkles, Star, Stethoscope, Syringe, Target, Thermometer, Timer,
  TrainFront, Trophy, Users, Video, Wallet, Wind, Accessibility, type LucideIcon,
} from 'lucide-react'

/** Icons the CMS offers in its icon picker (stored in content by name). */
export const ICONS: Record<string, LucideIcon> = {
  HeartPulse, Brain, Bone, Baby, Stethoscope, Flower2, Sparkles, Ear, ScanLine, Siren, Microscope, Droplet, Droplets, Eye, Dna,
  Pill, Syringe, Thermometer, Activity, Radiation, Wind, Smile, Cross, Ambulance, MonitorDot, House, Video, ClipboardCheck,
  ClipboardList, FileCheck2, FileText, FlaskConical, Bed, Coffee, Timer, Clock, CalendarCheck, CalendarDays,
  CreditCard, Wallet, Users, HandHeart, HeartHandshake, ShieldCheck, BadgeCheck, Award, Trophy, Star, GraduationCap, Target,
  Lightbulb, Leaf, Globe2, Building2, MapPin, Phone, TrainFront, Car, Accessibility,
}
export const ICON_NAMES = Object.keys(ICONS)
export const iconFor = (name?: string): LucideIcon => (name && ICONS[name]) || Sparkles
