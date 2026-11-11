// Raw values keep numeric ordering independent of currency display rounding.
document.querySelectorAll('table[data-sortable]').forEach((table) => {
  const heads = [...table.tHead.rows[0].cells];
  const body = table.tBodies[0];
  const originalRows = [...body.rows];
  const collator = new Intl.Collator(document.documentElement.lang, { numeric: true });
  heads.forEach((head, column) => {
    const button = head.querySelector('button');
    button.addEventListener('click', () => {
      const previous = head.getAttribute('aria-sort');
      const direction = previous === 'none' ? button.dataset.defaultDirection
        : previous === 'ascending' ? 'descending' : 'ascending';
      const sign = direction === 'ascending' ? 1 : -1;
      const rows = [...originalRows].sort((a, b) => {
        const av = a.cells[column].dataset.sortValue;
        const bv = b.cells[column].dataset.sortValue;
        // Unknown dates/prices stay last in either direction; zero is a value.
        if (av === '' || bv === '') return (av === '') - (bv === '');
        return sign * (button.dataset.sortType === 'number'
          ? Number(av) - Number(bv) : collator.compare(av, bv));
      });
      body.append(...rows);
      heads.forEach((h) => {
        h.setAttribute('aria-sort', h === head ? direction : 'none');
        h.querySelector('.sort-indicator').textContent = h === head
          ? direction === 'ascending' ? '↑' : '↓' : '↕';
      });
    });
  });
});
