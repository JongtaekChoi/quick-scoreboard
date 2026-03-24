"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  addGoalDetailed,
  applyPeriodAction,
  updateGoalEventFromForm,
  deleteGoalEventFromForm,
  submitAnonymousRating,
  addSubstitutionEvent,
  undoSubstitutionEvent,
  cancelReservedSubstitution,
} from "./actions";

function useInvalidateMatch(matchId: string) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["match-detail", matchId] });
    queryClient.invalidateQueries({ queryKey: ["scoreboard", matchId] });
  };
}

export function useAddGoal(
  matchId: string,
  teamSide: "A" | "B",
  channelSlug: string,
  channelVersion: number,
  opts?: { onSuccess?: () => void; onError?: (msg: string) => void },
) {
  const invalidate = useInvalidateMatch(matchId);
  return useMutation({
    mutationFn: (formData: FormData) =>
      addGoalDetailed(matchId, teamSide, channelSlug, channelVersion, formData),
    onSuccess: (result) => {
      invalidate();
      if ("error" in result) {
        opts?.onError?.(result.error);
      } else {
        opts?.onSuccess?.();
      }
    },
    onError: () => opts?.onError?.("network_error"),
  });
}

export function useApplyPeriod(
  matchId: string,
  channelSlug: string,
  channelVersion: number,
  action: "start_period" | "end_period" | "resume_previous",
  opts?: { onSuccess?: () => void; onError?: (msg: string) => void },
) {
  const invalidate = useInvalidateMatch(matchId);
  return useMutation({
    mutationFn: () =>
      applyPeriodAction(matchId, channelSlug, channelVersion, action),
    onSuccess: (result) => {
      invalidate();
      if ("error" in result) {
        opts?.onError?.(result.error);
      } else {
        opts?.onSuccess?.();
      }
    },
    onError: () => opts?.onError?.("network_error"),
  });
}

export function useUpdateGoal(
  matchId: string,
  channelSlug: string,
  channelVersion: number,
  opts?: { onSuccess?: () => void; onError?: (msg: string) => void },
) {
  const invalidate = useInvalidateMatch(matchId);
  return useMutation({
    mutationFn: (formData: FormData) =>
      updateGoalEventFromForm(matchId, channelSlug, channelVersion, formData),
    onSuccess: (result) => {
      invalidate();
      if ("error" in result) {
        opts?.onError?.(result.error);
      } else {
        opts?.onSuccess?.();
      }
    },
    onError: () => opts?.onError?.("network_error"),
  });
}

export function useDeleteGoal(
  matchId: string,
  channelSlug: string,
  channelVersion: number,
  opts?: { onSuccess?: () => void; onError?: (msg: string) => void },
) {
  const invalidate = useInvalidateMatch(matchId);
  return useMutation({
    mutationFn: (formData: FormData) =>
      deleteGoalEventFromForm(matchId, channelSlug, channelVersion, formData),
    onSuccess: (result) => {
      invalidate();
      if ("error" in result) {
        opts?.onError?.(result.error);
      } else {
        opts?.onSuccess?.();
      }
    },
    onError: () => opts?.onError?.("network_error"),
  });
}

export function useSubmitRating(
  matchId: string,
  channelSlug: string,
  opts?: { onSuccess?: () => void; onError?: (msg: string) => void },
) {
  const invalidate = useInvalidateMatch(matchId);
  return useMutation({
    mutationFn: (formData: FormData) =>
      submitAnonymousRating(matchId, channelSlug, formData),
    onSuccess: (result) => {
      invalidate();
      if ("error" in result) {
        opts?.onError?.(result.error);
      } else {
        opts?.onSuccess?.();
      }
    },
    onError: () => opts?.onError?.("network_error"),
  });
}

export function useAddSubstitution(
  matchId: string,
  channelSlug: string,
  opts?: {
    onSuccess?: (undoIds?: string) => void;
    onError?: (msg: string) => void;
  },
) {
  const invalidate = useInvalidateMatch(matchId);
  return useMutation({
    mutationFn: (formData: FormData) =>
      addSubstitutionEvent(matchId, channelSlug, formData),
    onSuccess: (result) => {
      invalidate();
      if ("error" in result) {
        opts?.onError?.(result.error);
      } else {
        opts?.onSuccess?.(result.undoIds);
      }
    },
    onError: () => opts?.onError?.("network_error"),
  });
}

export function useUndoSubstitution(
  matchId: string,
  channelSlug: string,
  opts?: { onSuccess?: () => void; onError?: (msg: string) => void },
) {
  const invalidate = useInvalidateMatch(matchId);
  return useMutation({
    mutationFn: (formData: FormData) =>
      undoSubstitutionEvent(matchId, channelSlug, formData),
    onSuccess: (result) => {
      invalidate();
      if ("error" in result) {
        opts?.onError?.(result.error);
      } else {
        opts?.onSuccess?.();
      }
    },
    onError: () => opts?.onError?.("network_error"),
  });
}

export function useCancelReservedSubstitution(
  matchId: string,
  channelSlug: string,
  opts?: { onSuccess?: () => void; onError?: (msg: string) => void },
) {
  const invalidate = useInvalidateMatch(matchId);
  return useMutation({
    mutationFn: (formData: FormData) =>
      cancelReservedSubstitution(matchId, channelSlug, formData),
    onSuccess: (result) => {
      invalidate();
      if ("error" in result) {
        opts?.onError?.(result.error);
      } else {
        opts?.onSuccess?.();
      }
    },
    onError: () => opts?.onError?.("network_error"),
  });
}
