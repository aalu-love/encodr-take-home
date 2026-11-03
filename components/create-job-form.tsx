"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createJobSchema, type CreateJobInput } from "@/lib/schemas";
import { ApiError } from "@/lib/client/api";
import { useCreateJob } from "@/lib/client/hooks";

const FORM_FIELDS = ["sourceUrl", "title"] as const;
type FormField = (typeof FORM_FIELDS)[number];

function isFormField(name: string): name is FormField {
  return (FORM_FIELDS as readonly string[]).includes(name);
}

/**
 * Create-job form. Client validation comes from createJobSchema (the same schema the server uses).
 * Server 400s put their messages on the matching field; anything else shows as a form-level error.
 */
export function CreateJobForm() {
  const create = useCreateJob();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateJobInput>({
    resolver: zodResolver(createJobSchema),
    defaultValues: { sourceUrl: "", title: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await create.mutateAsync(values);
      reset();
    } catch (e) {
      if (!(e instanceof ApiError)) {
        setFormError("Couldn’t create the job. Check your connection and try again.");
        return;
      }
      const unmapped: string[] = [];
      for (const [field, message] of Object.entries(e.fieldErrors ?? {})) {
        if (isFormField(field)) setError(field, { message });
        else unmapped.push(message);
      }
      if (!e.fieldErrors || unmapped.length > 0) {
        setFormError(unmapped.length > 0 ? unmapped.join(" ") : e.message);
      }
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="sourceUrl" className="mb-1 block text-sm font-medium">
          Source URL
        </label>
        <input
          id="sourceUrl"
          {...register("sourceUrl")}
          type="url"
          placeholder="https://cdn.example.com/videos/clip.mp4"
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
        {errors.sourceUrl && (
          <p role="alert" className="mt-1 text-xs text-red-600">
            {errors.sourceUrl.message}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="title" className="mb-1 block text-sm font-medium">
          Title <span className="font-normal text-neutral-400">(optional)</span>
        </label>
        <input
          id="title"
          {...register("title")}
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
        {errors.title && (
          <p role="alert" className="mt-1 text-xs text-red-600">
            {errors.title.message}
          </p>
        )}
      </div>

      {formError && (
        <p role="alert" className="text-sm text-red-600">
          {formError}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {isSubmitting ? "Creating…" : "Create job"}
      </button>
    </form>
  );
}
