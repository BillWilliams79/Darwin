import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,      // 30 seconds
            gcTime: 600_000,        // 10 minutes
            refetchOnWindowFocus: true,
            retry: 2,
        },
    },
});

export { queryClient };

const QueryClientSetup = ({ children }) => (
    <QueryClientProvider client={queryClient}>
        {children}
    </QueryClientProvider>
);

export default QueryClientSetup;
