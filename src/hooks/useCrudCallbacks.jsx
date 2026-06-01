export function useCrudCallbacks({ items, setItems, fieldName, saveFn }) {

    const fieldChange = (event, index) => {
        // Immutable update — a new object at the target index rather than an
        // in-place mutation. Local state arrays here are seeded from TanStack
        // query data via a shallow copy (e.g. CategoryCard / AreaTabPanel), so
        // the row objects are shared by reference with the query cache. Mutating
        // one in place silently poisons the cached snapshot. This mirrors the
        // immutable pattern already used in CategoryCard.statusClick /
        // coordinationClick (req #2747).
        const value = event.target.value;
        setItems(items.map((item, i) => (i === index ? { ...item, [fieldName]: value } : item)));
    };

    const fieldKeyDown = (event, index, id) => {
        if (event.key === 'Enter') {
            saveFn(event, index, id);
            event.preventDefault();
        }
    };

    const fieldOnBlur = (event, index, id) => {
        saveFn(event, index, id);
    };

    return { fieldChange, fieldKeyDown, fieldOnBlur };
}
