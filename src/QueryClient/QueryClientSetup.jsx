import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

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
        <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
);

export default QueryClientSetup;
