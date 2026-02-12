export function useCrudCallbacks({ items, setItems, fieldName, saveFn, blockApostrophe = true }) {

    const fieldChange = (event, index) => {
        let newItems = [...items];
        newItems[index][fieldName] = event.target.value;
        setItems(newItems);
    };

    const fieldKeyDown = (event, index, id) => {
        if (event.key === 'Enter') {
            saveFn(event, index, id);
            event.preventDefault();
        }
        if (blockApostrophe && event.key === "'") {
            event.preventDefault();
        }
    };

    const fieldOnBlur = (event, index, id) => {
        saveFn(event, index, id);
    };

    return { fieldChange, fieldKeyDown, fieldOnBlur };
}
