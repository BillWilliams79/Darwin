import { create } from 'zustand';

export const useSnackBarStore = create((set) => ({
    open: false,
    message: '',
    showError: (error, errorText) => {
        set({ message: `${errorText} ${error.httpStatus.httpStatus}`, open: true });
    },
    close: () => set({ open: false }),
}));
