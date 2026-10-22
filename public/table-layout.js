// The second frozen column follows the name column's intrinsic rendered width.
export function initContentSizedTables(root = document) {
  for (const container of root.querySelectorAll('.audience-preview-table, .compact-recipient-table')) {
    if (container.dataset.contentSized) continue;
    const table = container.querySelector('table');
    if (!table) continue;
    container.dataset.contentSized = 'true';
    let frame;
    const measure = () => {
      frame = null;
      const width = table.querySelector('tr > :first-child')?.getBoundingClientRect().width;
      if (width > 0) container.style.setProperty('--frozen-name-width', `${width}px`);
    };
    const schedule = () => { if (frame == null) frame = requestAnimationFrame(measure); };
    new ResizeObserver(schedule).observe(table);
    new MutationObserver(schedule).observe(table, { childList: true, subtree: true, characterData: true });
    measure();
  }
}
