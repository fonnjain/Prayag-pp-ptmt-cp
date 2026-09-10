import { useQueryClient } from "@tanstack/react-query";
import {
  getListPlanRunsQueryKey,
  useCreatePlanRun,
  type PlanRunSummary,
} from "@workspace/api-client-react";

export function useRerunTemporaryPlan() {
  const createRun = useCreatePlanRun();
  const queryClient = useQueryClient();

  const rerunTemporaryPlan = (
    input: { month: string; segment: string; supersedesRunId: number },
    callbacks: { onSuccess?: (run: PlanRunSummary) => void; onError?: (error: unknown) => void } = {},
  ) => {
    createRun.mutate(
      {
        data: {
          month: input.month,
          segment: input.segment,
          planType: "temporary",
          temporaryRunId: null,
          supersedesRunId: input.supersedesRunId,
          note: `Draft rerun from Temporary Plan #${input.supersedesRunId}`,
        } as any,
      },
      {
        onSuccess: (run) => {
          queryClient.invalidateQueries({ queryKey: getListPlanRunsQueryKey({ month: input.month, segment: input.segment }) });
          callbacks.onSuccess?.(run as unknown as PlanRunSummary);
        },
        onError: callbacks.onError,
      },
    );
  };

  return { rerunTemporaryPlan, isPending: createRun.isPending };
}