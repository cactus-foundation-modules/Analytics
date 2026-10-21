// Analytics Puck block - editor-safe half. The real work happens in
// AnalyticsBlock.rsc.tsx, which reads the module's settings and the site's cookie
// banner and so cannot be imported from the editor bundle.
//
// The block carries no props: whether to count, and what to wait for, are
// site-wide decisions that live in module settings. It is a placement marker -
// "count every page that uses this layout" - and nothing more.

function EditorPreview() {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
      padding: '0.5rem 0.9rem', borderRadius: '0.5rem', margin: '0.5rem',
      background: 'var(--color-surface-subtle, #f4f1ea)',
      border: '1px dashed var(--color-border, #e5e0d8)',
      color: 'var(--color-text-secondary, #6b6355)',
      fontSize: '0.8125rem', fontWeight: 600,
    }}>
      🧭 Analytics (invisible on the real site)
    </div>
  )
}

export const analyticsBlockComponent = {
  label: 'Analytics',
  fields: {},
  defaultProps: {},
  render: EditorPreview,
}
