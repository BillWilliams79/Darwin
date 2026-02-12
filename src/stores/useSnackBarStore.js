import { create } from 'zustand';

export const useSnackBarStore = create((set) => ({
    open: false,
    message: '',
    showError: (error, errorText) => {
        console.log(`${errorText} ${error.httpStatus.httpStatus}`);
        console.log(`${error.httpStatus.httpMessage}`);
        set({ message: `${errorText} ${error.httpStatus.httpStatus}`, open: true });
    },
    close: () => set({ open: false }),
}));
