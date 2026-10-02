/* ------------------------------------------------------------------ */
/* Reusable homepage templates. Every homepage content block (a custom  */
/* class / event / service / other block, or a built-in section given a */
/* style) is reduced to the same shape and drawn by one of four         */
/* templates, so new content renders correctly in whichever is picked:  */
/*                                                                      */
/*   block = { eyebrow, title, body, meta, imageUrl, cta, items }       */
/*   cta   = { label, href, onClick, external }                         */
/*   items = [{ title, body, meta, imageUrl, cta }]  (cards / list)     */
/* ------------------------------------------------------------------ */

export const TEMPLATES = [
  { key: 'split', label: 'Image + text', hint: 'Picture beside the words; mirror to swap sides' },
  { key: 'banner', label: 'Full-width banner', hint: 'Big statement across the page' },
  { key: 'cards', label: 'Card grid', hint: '2 to 3 cards side by side' },
  { key: 'list', label: 'Simple list', hint: 'Heading with a tidy list of items' },
]
export const TEMPLATE_KEYS = TEMPLATES.map((template) => template.key)

const paragraphs = (text) => String(text || '').split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
const background = (url) => (url ? { backgroundImage: `url('${String(url).replace(/'/g, '%27')}')` } : undefined)

function Cta({ cta, variant = 'btn-solid' }) {
  if (!cta?.label) return null
  return <a href={cta.href || '#'} className={`btn ${variant} tpl-cta`} onClick={cta.onClick} {...(cta.external ? { target: '_blank', rel: 'noreferrer' } : {})}>{cta.label}</a>
}

function Heading({ block, as = 'h2' }) {
  const Tag = as
  return <>
    {block.eyebrow && <span className="eyebrow tpl-eyebrow">{block.eyebrow}</span>}
    <Tag className="display tpl-title">{block.title}</Tag>
    {block.meta && <div className="tpl-meta">{block.meta}</div>}
  </>
}

// 1. Image + text side by side (mirror puts the image on the right).
export function SplitTemplate({ block, mirror, anchorId }) {
  const image = block.imageUrl || block.items?.find((item) => item.imageUrl)?.imageUrl
  return (
    <section className={`tpl tpl-split${mirror ? ' is-mirrored' : ''}`} id={anchorId} data-template="split">
      <div className="wrap tpl-split-grid">
        <div className={`tpl-split-media${image ? '' : ' is-empty'}`} style={background(image)} role={image ? 'img' : undefined} aria-label={image ? block.title : undefined} />
        <div className="tpl-split-copy">
          <Heading block={block} />
          {paragraphs(block.body).map((text, index) => <p key={index}>{text}</p>)}
          {block.items?.length > 0 && (
            <ul className="tpl-split-items">
              {block.items.map((item, index) => <li key={index}><strong>{item.title}</strong>{item.meta && <span> · {item.meta}</span>}{item.body && <div>{item.body}</div>}</li>)}
            </ul>
          )}
          <Cta cta={block.cta} />
        </div>
      </div>
    </section>
  )
}

// 2. Full-width banner.
export function BannerTemplate({ block, anchorId }) {
  const image = block.imageUrl || block.items?.find((item) => item.imageUrl)?.imageUrl
  return (
    <section className={`tpl tpl-banner${image ? ' has-image' : ''}`} id={anchorId} data-template="banner">
      <div className="tpl-banner-bg" style={background(image)} />
      <div className="wrap tpl-banner-inner">
        <Heading block={block} />
        {paragraphs(block.body).map((text, index) => <p key={index}>{text}</p>)}
        {block.items?.length > 0 && (
          <div className="tpl-banner-items">
            {block.items.map((item, index) => <span key={index} className="tpl-chip">{item.title}{item.meta ? ` · ${item.meta}` : ''}</span>)}
          </div>
        )}
        <Cta cta={block.cta} variant="btn-gold" />
      </div>
    </section>
  )
}

// 3. Card grid: 2-3 cards. With no items, the block itself is the card.
export function CardGridTemplate({ block, anchorId }) {
  const cards = (block.items?.length ? block.items : [{ title: block.title, body: block.body, meta: block.meta, imageUrl: block.imageUrl, cta: block.cta }]).slice(0, 3)
  const ownCard = !block.items?.length
  return (
    <section className="tpl tpl-cards" id={anchorId} data-template="cards">
      <div className="wrap">
        <div className="section-head tpl-cards-head">
          {block.eyebrow && <span className="eyebrow tpl-eyebrow">{block.eyebrow}</span>}
          <h2 className="display tpl-title">{block.title}</h2>
          {!ownCard && paragraphs(block.body).map((text, index) => <p key={index}>{text}</p>)}
        </div>
        <div className="tpl-card-grid" data-count={cards.length}>
          {cards.map((card, index) => (
            <article className="tpl-card" key={index}>
              {card.imageUrl && <div className="tpl-card-img" style={background(card.imageUrl)} role="img" aria-label={card.title} />}
              <div className="tpl-card-body">
                {card.meta && <div className="tpl-meta">{card.meta}</div>}
                <h3 className="display">{card.title}</h3>
                {paragraphs(card.body).map((text, textIndex) => <p key={textIndex}>{text}</p>)}
                <Cta cta={card.cta} variant="btn-outline" />
              </div>
            </article>
          ))}
        </div>
        {!ownCard && <div className="tpl-cards-cta"><Cta cta={block.cta} /></div>}
      </div>
    </section>
  )
}

// 4. Simple list. With no items, each paragraph of the text is a line.
export function ListTemplate({ block, anchorId }) {
  const rows = block.items?.length ? block.items : paragraphs(block.body).map((text) => ({ title: text }))
  return (
    <section className="tpl tpl-list" id={anchorId} data-template="list">
      <div className="wrap tpl-list-grid">
        <div className="tpl-list-head">
          <Heading block={block} />
          {block.items?.length > 0 && paragraphs(block.body).map((text, index) => <p key={index}>{text}</p>)}
          <Cta cta={block.cta} />
        </div>
        <ol className="tpl-list-items">
          {rows.map((row, index) => (
            <li key={index}>
              <span className="tpl-list-num">{String(index + 1).padStart(2, '0')}</span>
              <div>
                {row.meta && <div className="tpl-meta">{row.meta}</div>}
                <div className="tpl-list-title">{row.title}</div>
                {row.body && <p>{row.body}</p>}
              </div>
              {row.cta?.label && <a href={row.cta.href || '#'} className="tpl-list-link" onClick={row.cta.onClick}>{row.cta.label} →</a>}
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

const RENDERERS = { split: SplitTemplate, banner: BannerTemplate, cards: CardGridTemplate, list: ListTemplate }

export function TemplateBlock({ template, mirror = false, block, anchorId }) {
  const Renderer = RENDERERS[template] || SplitTemplate
  return <Renderer block={block} mirror={mirror} anchorId={anchorId} />
}

/* Small schematic previews for the admin picker. */
const ink = '#0b3d2e'
const soft = '#d9cfae'
const line = (x, y, w, h = 4, fill = soft) => <rect x={x} y={y} width={w} height={h} rx={2} fill={fill} />
function Thumbnail({ template, mirror }) {
  return (
    <svg viewBox="0 0 120 72" width="120" height="72" aria-hidden="true" style={{ display: 'block', background: '#fffdf8', borderRadius: 6 }}>
      {template === 'split' && <>
        <rect x={mirror ? 66 : 8} y={10} width={46} height={52} rx={4} fill={ink} opacity={0.85} />
        {line(mirror ? 8 : 62, 16, 26, 4, '#a97e2b')}{line(mirror ? 8 : 62, 25, 48, 7, ink)}{line(mirror ? 8 : 62, 37, 48)}{line(mirror ? 8 : 62, 45, 40)}{line(mirror ? 8 : 62, 54, 22, 6, ink)}
      </>}
      {template === 'banner' && <>
        <rect x={0} y={8} width={120} height={56} fill={ink} opacity={0.9} />
        {line(42, 20, 36, 4, '#e4c876')}{line(22, 29, 76, 9, '#fffdf8')}{line(30, 43, 60, 4, '#c9bf9f')}{line(48, 51, 24, 7, '#c9a227')}
      </>}
      {template === 'cards' && <>
        {line(38, 7, 44, 6, ink)}
        {[8, 45, 82].map((x) => <g key={x}><rect x={x} y={18} width={30} height={46} rx={3} fill="#fff" stroke={soft} /><rect x={x} y={18} width={30} height={16} rx={3} fill={ink} opacity={0.8} />{line(x + 4, 39, 22, 4, ink)}{line(x + 4, 47, 18)}{line(x + 4, 54, 20)}</g>)}
      </>}
      {template === 'list' && <>
        {line(8, 12, 30, 7, ink)}{line(8, 24, 34)}{line(8, 32, 26)}
        {[12, 28, 44].map((y) => <g key={y}>{line(52, y, 8, 6, '#a97e2b')}{line(64, y, 46, 6, ink)}<rect x={52} y={y + 11} width={58} height={1} fill={soft} /></g>)}
      </>}
    </svg>
  )
}

export function TemplatePicker({ value, mirror = false, onChange, onMirrorChange, allowOriginal = false, name = 'template' }) {
  const options = allowOriginal ? [{ key: '', label: 'Original design', hint: "The section's own hand-made layout" }, ...TEMPLATES] : TEMPLATES
  return (
    <div>
      <div role="radiogroup" aria-label="Template style" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(134px, 1fr))', gap: 8 }}>
        {options.map((option) => {
          const selected = (value || '') === option.key
          return (
            <button key={option.key || 'original'} type="button" role="radio" aria-checked={selected} aria-label={option.label} name={name} onClick={() => onChange(option.key)} title={option.hint}
              style={{ border: `2px solid ${selected ? '#0b3d2e' : '#e4ddc9'}`, background: selected ? '#f3efe1' : '#fff', borderRadius: 8, padding: 6, cursor: 'pointer', textAlign: 'left' }}>
              {option.key ? <Thumbnail template={option.key} mirror={option.key === 'split' && mirror} /> : <div style={{ height: 72, display: 'grid', placeItems: 'center', fontSize: 11, color: '#767066', background: '#fffdf8', borderRadius: 6 }}>As designed</div>}
              <div style={{ fontSize: 12, fontWeight: 700, color: '#0b3d2e', marginTop: 5 }}>{option.label}</div>
            </button>
          )
        })}
      </div>
      {value === 'split' && onMirrorChange && (
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12.5, marginTop: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={mirror} onChange={(event) => onMirrorChange(event.target.checked)} /> Mirror (image on the right)
        </label>
      )}
    </div>
  )
}
