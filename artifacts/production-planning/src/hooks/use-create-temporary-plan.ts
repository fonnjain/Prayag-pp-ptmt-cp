import {
  getListAvailableMonthsQueryKey,
  useCreatePlanRun,
  useFinalizePlanRun,
  type CreatePlanRunRequest,
  type PlanRunSummary,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

type TemporaryPlanInput = Omit<CreatePlanRunRequest, "planType" | "temporaryRunId">;

type TemporaryPlanCallbacks = {
  onSuccess?: (run: PlanRunSummary) => void;
  onError?: (error: unknown) => void;
};

export function useCreateTemporaryPlan() {
  const createRun = useCreatePlanRun();
  const finalizeRun = useFinalizePlanRun();
  const queryClient = useQueryClient();

  const createTemporaryPlan = (
    input: TemporaryPlanInput,
    callbacks: TemporaryPlanCallbacks = {},
  ) => {
    createRun.mutate(
      {
        data: {
          ...input,
          planType: "temporary",
          temporaryRunId: null,
        },
      },
      {
        onSuccess: (rawRun) => {
          const draft = rawRun as unknown as PlanRunSummary;
          const runId = Number(draft.id);
          if (!Number.isInteger(runId) || runId <= 0) {
            callbacks.onError?.(new Error("Temporary Plan was created without a valid run ID."));
            return;
          }

          finalizeRun.mutate(
            { id: runId, data: {} },
            {
              onSuccess: () => {
                queryClient.invalidateQueries({ queryKey: getListAvailableMonthsQueryKey() });
                callbacks.onSuccess?.({ ...draft, status: "finalized" });
              },
              onError: callbacks.onError,
            },
          );
        },
        onError: callbacks.onError,
      },
    );
  };

  return {
    createTemporaryPlan,
    isPending: createRun.isPending || finalizeRun.isPending,
  };
}