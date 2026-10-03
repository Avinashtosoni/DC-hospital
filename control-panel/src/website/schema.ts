/**
 * Editor forms for the product site's pages (control panel → Website). Rendered by the hospital CMS's FieldsForm,
 * so field types match src/pages/cms/schema.ts. Content types: src/platform/site/types.ts.
 */
import type { LucideIcon } from 'lucide-react'
import { BadgeIndianRupee, BookOpenText, Building2, CircleHelp, House, Info, LayoutGrid, Mail, Newspaper, Palette, Scale, ShieldCheck } from 'lucide-react'
import type { FieldDef } from '../../../src/pages/cms/schema'
import type { PageKey } from '../../../src/platform/site/types'

const RICH = 'Wrap words in *asterisks* to highlight them.'
const TOKENS = 'You can use {platform}, {company}, {email}, {phone}, {address} — filled in automatically.'

const seo = (): FieldDef => ({
  k: 'seo', t: 'group', label: 'Search engine (SEO)', collapsed: true, fields: [
    { k: 'title', t: 'text', label: 'Page title', hint: `Shown in the browser tab and Google. "· {platform}" is added automatically.`, full: true },
    { k: 'description', t: 'textarea', label: 'Meta description', rows: 2, hint: 'About 150 characters. ' + TOKENS, full: true },
    { k: 'image', t: 'image', label: 'Share image (optional)', hint: 'Shown when the link is shared on WhatsApp / social media. 1200×630 works best.' },
  ],
})
const headingFields = (): FieldDef[] => [
  { k: 'eyebrow', t: 'text', label: 'Small label above' },
  { k: 'title', t: 'rich', label: 'Heading', hint: RICH },
  { k: 'lead', t: 'textarea', label: 'Intro text', rows: 2, full: true },
]
const heading = (k: string, label: string, extra: FieldDef[] = [], collapsed = false): FieldDef => ({ k, t: 'group', label, collapsed, fields: [...headingFields(), ...extra] })
const cta = (): FieldDef => ({
  k: 'cta', t: 'group', label: 'Call-to-action band (bottom)', collapsed: true, fields: [
    { k: 'title', t: 'rich', label: 'Heading', hint: 'Leave empty to hide the band.' },
    { k: 'lead', t: 'textarea', label: 'Text', rows: 2, full: true },
    { k: 'button', t: 'text', label: 'Button text' },
    { k: 'link', t: 'text', label: 'Button link', hint: 'A page like /signup or /contact, or a full https:// address.' },
  ],
})
const iconItems = (k: string, label: string, noun: string): FieldDef => ({
  k, t: 'list', label, title: (v) => v.title || `Untitled ${noun}`, subtitle: (v) => v.text, addLabel: `Add ${noun}`,
  newItem: () => ({ icon: 'Sparkles', title: `New ${noun}`, text: '' }),
  item: [{ k: 'icon', t: 'icon', label: 'Icon' }, { k: 'title', t: 'text', label: 'Title' }, { k: 'text', t: 'textarea', label: 'Text', rows: 2, full: true }],
})
const qaList = (k: string, label: string): FieldDef => ({
  k, t: 'list', label, title: (v) => v.q || 'New question', subtitle: (v) => v.a, addLabel: 'Add question',
  newItem: () => ({ q: 'New question?', a: '' }),
  item: [{ k: 'q', t: 'text', label: 'Question', full: true }, { k: 'a', t: 'textarea', label: 'Answer', rows: 3, full: true }],
})
const steps = (k: string, label: string): FieldDef => ({
  k, t: 'list', label, title: (v, i) => `${i + 1}. ${v.title || 'Step'}`, subtitle: (v) => v.text, addLabel: 'Add step',
  newItem: () => ({ title: 'New step', text: '' }), item: [{ k: 'title', t: 'text', label: 'Title' }, { k: 'text', t: 'textarea', label: 'Text', rows: 2, full: true }],
})
const PLAN_OPTS = ['clinic', 'hospital', 'enterprise', 'custom']

export interface PageMeta { key: PageKey; label: string; path: string; icon: LucideIcon; help: string; fields: FieldDef[] }

export const PAGES: PageMeta[] = [
  {
    key: 'brand', label: 'Brand & contact', path: '/', icon: Palette, help: 'Logo, contact details, social links and the announcement bar — used on every page.',
    fields: [
      { k: 'logo', t: 'image', label: 'Logo', hint: 'Optional. Wide logos (about 4:1) look best. Empty = the stethoscope icon.' },
      { k: 'tagline', t: 'text', label: 'Tagline', hint: 'Used as the home page title when SEO title is empty.' },
      { k: 'footerText', t: 'textarea', label: 'Footer text', rows: 2, full: true },
      { k: 'email', t: 'text', label: 'E-mail', hint: '{email} = PLATFORM_EMAIL from the server settings.' },
      { k: 'phone', t: 'text', label: 'Phone', hint: '{phone} = PLATFORM_PHONE.' },
      { k: 'whatsapp', t: 'text', label: 'WhatsApp number', placeholder: '98765 43210', hint: 'Shown on the Contact page as a chat link.' },
      { k: 'hours', t: 'text', label: 'Office hours' },
      { k: 'address', t: 'textarea', label: 'Address', rows: 2, full: true },
      {
        k: 'announcement', t: 'group', label: 'Announcement bar (top of every page)', fields: [
          { k: 'enabled', t: 'toggle', label: 'Show the bar' },
          { k: 'text', t: 'text', label: 'Text', full: true },
          { k: 'linkText', t: 'text', label: 'Link text' },
          { k: 'link', t: 'text', label: 'Link', hint: '/features, /blog/… or https://…' },
        ],
      },
      {
        k: 'social', t: 'group', label: 'Social profiles', collapsed: true, fields: [
          { k: 'linkedin', t: 'url', label: 'LinkedIn' }, { k: 'x', t: 'url', label: 'X (Twitter)' }, { k: 'facebook', t: 'url', label: 'Facebook' },
          { k: 'instagram', t: 'url', label: 'Instagram' }, { k: 'youtube', t: 'url', label: 'YouTube' },
        ],
      },
    ],
  },
  {
    key: 'home', label: 'Home', path: '/', icon: House, help: 'The first page visitors see.',
    fields: [
      seo(),
      {
        k: 'hero', t: 'group', label: 'Top banner', fields: [
          { k: 'badge', t: 'text', label: 'Badge' },
          { k: 'title', t: 'rich', label: 'Headline', hint: RICH, full: true },
          { k: 'lead', t: 'textarea', label: 'Text', rows: 3, full: true },
          { k: 'primary', t: 'text', label: 'Main button (→ free trial)' },
          { k: 'secondary', t: 'text', label: 'Second button (→ contact)' },
          { k: 'note', t: 'text', label: 'Small print under the buttons', full: true },
          { k: 'image', t: 'image', label: 'Picture (optional)', hint: 'Empty = the illustrated dashboard.' },
        ],
      },
      {
        k: 'stats', t: 'list', label: 'Numbers strip', title: (v) => `${v.value} ${v.label}`, addLabel: 'Add number', newItem: () => ({ value: '', label: '' }),
        item: [{ k: 'value', t: 'text', label: 'Number' }, { k: 'label', t: 'text', label: 'Label' }],
      },
      {
        k: 'roles', t: 'group', label: 'Roles strip', collapsed: true, fields: [
          { k: 'title', t: 'text', label: 'Title', full: true },
          { k: 'items', t: 'list', label: 'Roles', title: (v) => v.name, subtitle: (v) => v.text, addLabel: 'Add role', newItem: () => ({ name: 'Role', text: '' }), item: [{ k: 'name', t: 'text', label: 'Name' }, { k: 'text', t: 'text', label: 'Text' }] },
        ],
      },
      heading('problems', 'Before / after (why switch)', [
        { k: 'before', t: 'strings', label: 'Without a system (problems)', addLabel: 'Add problem' },
        { k: 'after', t: 'strings', label: 'With the platform (answers)', addLabel: 'Add answer' },
      ], true),
      heading('highlights', 'Feature highlights', [iconItems('items', 'Highlights', 'feature')]),
      {
        k: 'steps', t: 'group', label: 'How it works', collapsed: true, fields: [
          { k: 'items', t: 'list', label: 'Steps', title: (v, i) => `${i + 1}. ${v.title}`, addLabel: 'Add step', newItem: () => ({ title: 'Step', text: '' }), item: [{ k: 'title', t: 'text', label: 'Title' }, { k: 'text', t: 'text', label: 'Text' }] },
        ],
      },
      heading('india', 'Made for India', [iconItems('items', 'Points', 'point')], true),
      { k: 'integrations', t: 'group', label: 'Integrations strip', collapsed: true, fields: [{ k: 'title', t: 'text', label: 'Title', full: true }, { k: 'items', t: 'tags', label: 'Names', placeholder: 'Type and press Enter' }] },
      heading('website', 'Website section', [{ k: 'points', t: 'strings', label: 'Points', addLabel: 'Add point' }, { k: 'image', t: 'image', label: 'Picture (optional)', hint: 'Empty = illustrated website.' }], true),
      heading('pricing', 'Pricing section (plans come from billing)', [], true),
      heading('testimonials', 'Testimonials (hidden while empty)', [{
        k: 'items', t: 'list', label: 'Testimonials', title: (v) => v.name || 'New testimonial', subtitle: (v) => v.quote, thumb: (v) => v.photo, addLabel: 'Add testimonial',
        newItem: () => ({ quote: '', name: '', role: '', photo: '' }),
        item: [{ k: 'quote', t: 'textarea', label: 'Quote', rows: 3, full: true }, { k: 'name', t: 'text', label: 'Name' }, { k: 'role', t: 'text', label: 'Role & hospital' }, { k: 'photo', t: 'image', label: 'Photo' }],
      }], true),
      heading('faq', 'FAQ preview', [qaList('items', 'Questions')], true),
      cta(),
    ],
  },
  {
    key: 'features', label: 'Features', path: '/features', icon: LayoutGrid, help: 'Every module in detail.',
    fields: [
      seo(), heading('heading', 'Page heading'),
      {
        k: 'modules', t: 'list', label: 'Modules', title: (v) => v.title || 'New module', subtitle: (v) => v.summary, thumb: (v) => v.image, addLabel: 'Add module',
        newItem: () => ({ icon: 'Sparkles', title: 'New module', summary: '', points: [], image: '' }),
        item: [
          { k: 'icon', t: 'icon', label: 'Icon' }, { k: 'title', t: 'text', label: 'Title' }, { k: 'summary', t: 'text', label: 'One-line summary', full: true },
          { k: 'points', t: 'strings', label: 'Points', addLabel: 'Add point' }, { k: 'image', t: 'image', label: 'Screenshot (optional)' },
        ],
      },
      heading('journey', 'Patient journey', [steps('items', 'Steps')], true),
      heading('byRole', 'For every role', [{
        k: 'items', t: 'list', label: 'Roles', title: (v) => v.name, subtitle: (v) => (v.points ?? []).join(' · '), addLabel: 'Add role',
        newItem: () => ({ name: 'Role', icon: 'Users', points: [] }), item: [{ k: 'icon', t: 'icon', label: 'Icon' }, { k: 'name', t: 'text', label: 'Role' }, { k: 'points', t: 'strings', label: 'Points', addLabel: 'Add point' }],
      }], true),
      heading('extras', '“Also included”', [iconItems('items', 'Items', 'item')], true),
      cta(),
    ],
  },
  {
    key: 'solutions', label: 'Solutions', path: '/solutions', icon: Building2, help: 'Who it is for — clinics, hospitals, nursing homes, groups.',
    fields: [
      seo(), heading('heading', 'Page heading'),
      {
        k: 'items', t: 'list', label: 'Solutions', title: (v) => v.title || 'New solution', subtitle: (v) => v.lead, thumb: (v) => v.image, addLabel: 'Add solution',
        newItem: () => ({ icon: 'Building2', title: 'New solution', lead: '', points: [], plan: 'hospital', image: '' }),
        item: [
          { k: 'icon', t: 'icon', label: 'Icon' }, { k: 'title', t: 'text', label: 'Title' }, { k: 'lead', t: 'text', label: 'Sub-title', full: true },
          { k: 'points', t: 'strings', label: 'Points', addLabel: 'Add point' }, { k: 'plan', t: 'select', label: 'Recommended plan', options: PLAN_OPTS }, { k: 'image', t: 'image', label: 'Picture (optional)' },
        ],
      },
      heading('specialities', 'Specialities', [iconItems('items', 'Specialities', 'speciality')], true),
      heading('switching', 'Switching / go-live plan', [steps('items', 'Steps')], true),
      cta(),
    ],
  },
  {
    key: 'pricing', label: 'Pricing', path: '/pricing', icon: BadgeIndianRupee, help: 'Plan cards come from billing (prices must match what is charged); edit the comparison, add-ons and questions here.',
    fields: [
      seo(), heading('heading', 'Page heading'),
      { k: 'note', t: 'textarea', label: 'Note under the plans', rows: 2, full: true },
      heading('included', 'Included in every plan', [{ k: 'items', t: 'strings', label: 'Items', addLabel: 'Add item' }], true),
      {
        k: 'compare', t: 'group', label: 'Comparison table', fields: [
          { k: 'title', t: 'text', label: 'Title', full: true },
          {
            k: 'rows', t: 'list', label: 'Rows', title: (v) => v.feature || 'New row', subtitle: (v) => `${v.clinic} · ${v.hospital} · ${v.enterprise}`, addLabel: 'Add row',
            newItem: () => ({ feature: '', clinic: '✓', hospital: '✓', enterprise: '✓' }),
            item: [{ k: 'feature', t: 'text', label: 'Feature', full: true }, { k: 'clinic', t: 'text', label: 'Clinic', hint: '✓ = included, — = not included, or any text' }, { k: 'hospital', t: 'text', label: 'Hospital' }, { k: 'enterprise', t: 'text', label: 'Enterprise' }],
          },
        ],
      },
      heading('addons', 'Add-ons', [{
        k: 'items', t: 'list', label: 'Add-ons', title: (v) => v.title, subtitle: (v) => v.price, addLabel: 'Add add-on', newItem: () => ({ title: 'New add-on', price: '', text: '' }),
        item: [{ k: 'title', t: 'text', label: 'Title' }, { k: 'price', t: 'text', label: 'Price label' }, { k: 'text', t: 'textarea', label: 'Text', rows: 2, full: true }],
      }], true),
      qaList('faqs', 'Pricing questions'),
      cta(),
    ],
  },
  {
    key: 'security', label: 'Security', path: '/security', icon: ShieldCheck, help: 'How data is protected — for owners and their IT / compliance teams.',
    fields: [
      seo(), heading('heading', 'Page heading'), iconItems('items', 'Security points', 'point'),
      heading('compliance', 'Compliance box', [{ k: 'points', t: 'strings', label: 'Points', addLabel: 'Add point' }], true),
      heading('access', 'Who sees what (table)', [{
        k: 'rows', t: 'list', label: 'Rows', title: (v) => v.role, subtitle: (v) => v.can, addLabel: 'Add row', newItem: () => ({ role: '', can: '', cannot: '' }),
        item: [{ k: 'role', t: 'text', label: 'Role', full: true }, { k: 'can', t: 'textarea', label: 'Can see & do', rows: 2 }, { k: 'cannot', t: 'textarea', label: 'Can’t', rows: 2 }],
      }], true),
      qaList('faqs', 'Security questions'),
      { k: 'note', t: 'textarea', label: 'Note (responsible disclosure)', rows: 2, full: true },
      cta(),
    ],
  },
  {
    key: 'about', label: 'About us', path: '/about', icon: Info, help: 'Your story, mission, values and team.',
    fields: [
      seo(), heading('heading', 'Page heading'),
      { k: 'story', t: 'strings', label: 'Story (one paragraph per item)', multiline: true, addLabel: 'Add paragraph' },
      { k: 'image', t: 'image', label: 'Picture (optional)' },
      { k: 'mission', t: 'group', label: 'Mission', collapsed: true, fields: [{ k: 'title', t: 'text', label: 'Title' }, { k: 'text', t: 'textarea', label: 'Text', rows: 3, full: true }] },
      { k: 'vision', t: 'group', label: 'Vision', collapsed: true, fields: [{ k: 'title', t: 'text', label: 'Title' }, { k: 'text', t: 'textarea', label: 'Text', rows: 3, full: true }] },
      heading('values', 'Values', [iconItems('items', 'Values', 'value')], true),
      heading('approach', 'How we work', [steps('items', 'Points')], true),
      heading('team', 'Team (hidden while empty)', [{
        k: 'items', t: 'list', label: 'People', title: (v) => v.name || 'New person', subtitle: (v) => v.role, thumb: (v) => v.photo, addLabel: 'Add person',
        newItem: () => ({ name: '', role: '', photo: '', bio: '' }),
        item: [{ k: 'name', t: 'text', label: 'Name' }, { k: 'role', t: 'text', label: 'Role' }, { k: 'photo', t: 'image', label: 'Photo' }, { k: 'bio', t: 'textarea', label: 'Short bio', rows: 2, full: true }],
      }], true),
      cta(),
    ],
  },
  {
    key: 'contact', label: 'Contact', path: '/contact', icon: Mail, help: 'The call-back form sends to Leads. Contact details come from Brand & contact.',
    fields: [
      seo(), heading('heading', 'Page heading'),
      { k: 'formTitle', t: 'text', label: 'Form title' },
      { k: 'thanks', t: 'text', label: 'Thank-you message' },
      { k: 'mapUrl', t: 'url', label: 'Map embed link (optional)', hint: 'Google Maps → Share → Embed a map → copy only the https://… address inside src="…".', full: true },
      heading('next', 'What happens next', [steps('items', 'Steps')], true),
      qaList('faqs', 'Questions under the form'),
    ],
  },
  {
    key: 'faq', label: 'FAQ', path: '/faq', icon: CircleHelp, help: 'Questions grouped by topic.',
    fields: [
      seo(), heading('heading', 'Page heading'),
      { k: 'groups', t: 'list', label: 'Topics', title: (v) => v.title || 'New topic', subtitle: (v) => `${v.items?.length ?? 0} questions`, addLabel: 'Add topic', newItem: () => ({ title: 'New topic', items: [] }), item: [{ k: 'title', t: 'text', label: 'Topic', full: true }, qaList('items', 'Questions')] },
      cta(),
    ],
  },
  {
    key: 'blog', label: 'Blog page', path: '/blog', icon: Newspaper, help: 'Heading of the blog list. Write articles in the Blog tab.',
    fields: [seo(), heading('heading', 'Page heading'), { k: 'empty', t: 'text', label: 'Text when there are no articles', full: true }, cta()],
  },
  {
    key: 'legal', label: 'Legal pages', path: '/legal/terms', icon: Scale, help: 'Terms, Privacy, Refunds, DPA, Cookies, Grievances and more. ⚠ Have a lawyer review changes. Bump “Last updated” when the meaning changes. To remove a built-in page switch on “Hide” (deleting it brings the default back).',
    fields: [{
      k: 'docs', t: 'list', label: 'Documents', title: (v) => v.title || v.slug, subtitle: (v) => `/legal/${v.slug}${v.hidden ? ' · hidden' : ''}`, addLabel: 'Add document',
      preview: (v) => `/legal/${v.slug}`,
      newItem: () => ({ slug: 'new-page', title: 'New page', short: 'New', updated: new Date().toISOString().slice(0, 10), intro: '', sections: [] }),
      item: [
        { k: 'title', t: 'text', label: 'Title' },
        { k: 'slug', t: 'text', label: 'Address', hint: 'Small letters and dashes only — the page is /legal/<address>. Don’t change it for existing pages (links point to it).' },
        { k: 'updated', t: 'text', label: 'Last updated (YYYY-MM-DD)' },
        { k: 'hidden', t: 'toggle', label: 'Hide this page' },
        { k: 'intro', t: 'textarea', label: 'Introduction', rows: 3, full: true, hint: TOKENS },
        {
          k: 'sections', t: 'list', label: 'Sections', title: (v) => v.h || 'Untitled section', subtitle: (v) => v.p?.[0], addLabel: 'Add section', newItem: () => ({ h: 'New section', p: [''] }),
          item: [{ k: 'h', t: 'text', label: 'Heading', full: true }, { k: 'p', t: 'strings', label: 'Paragraphs', multiline: true, addLabel: 'Add paragraph' }],
        },
      ],
    }],
  },
]
export const BLOG_ICON = BookOpenText
