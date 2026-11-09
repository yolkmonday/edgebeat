import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { Group } from "@shared/admin-api";
import { useCreateGroup, useUpdateGroup } from "@/api/use-groups";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { groupFormSchema, slugify, type GroupFormValues } from "@/features/groups/group-form";
import { fieldErrors, isApiError } from "@/lib/api";

const FORM_ID = "group-form";

const GroupForm = ({ group, nextSort, onDone }: { group?: Group; nextSort: number; onDone: () => void }) => {
  const create = useCreateGroup();
  const update = useUpdateGroup();
  const [slugTouched, setSlugTouched] = useState(Boolean(group));
  const {
    register,
    handleSubmit,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<GroupFormValues>({
    resolver: zodResolver(groupFormSchema),
    defaultValues: { name: group?.name ?? "", slug: group?.slug ?? "" },
  });

  const onSubmit = async (values: GroupFormValues) => {
    try {
      if (group) await update.mutateAsync({ id: group.id, patch: { name: values.name, slug: values.slug } });
      else await create.mutateAsync({ name: values.name, slug: values.slug, sort: nextSort });
      toast.success(group ? "Group saved" : "Group added");
      onDone();
    } catch (e) {
      if (!isApiError(e)) return void toast.error("Couldn't save the group");
      if (e.status === 409 || e.code === "slug_conflict") return setError("slug", { message: "Another group already uses this slug." });
      const mapped = fieldErrors(e);
      const known = (["name", "slug"] as const).filter((k) => mapped[k]);
      if (known.length === 0) return void toast.error("Couldn't save the group", { description: e.code });
      known.forEach((k) => setError(k, { message: mapped[k] }));
    }
  };

  const nameField = register("name");
  return (
    <>
      <form id={FORM_ID} onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
        <Field label="Name" htmlFor="group-name" error={errors.name?.message}>
          <Input
            autoFocus
            autoComplete="off"
            {...nameField}
            onChange={(e) => {
              void nameField.onChange(e);
              if (!slugTouched) setValue("slug", slugify(e.target.value), { shouldValidate: Boolean(errors.slug) });
            }}
          />
        </Field>
        <Field label="Slug" htmlFor="group-slug" helper="Used in URLs and the API." error={errors.slug?.message}>
          <Input mono autoComplete="off" {...register("slug", { onChange: () => setSlugTouched(true) })} />
        </Field>
      </form>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" form={FORM_ID} loading={isSubmitting}>
          {group ? "Save group" : "Add group"}
        </Button>
      </div>
    </>
  );
};

export type GroupDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group?: Group;
  nextSort: number;
};

export const GroupDialog = ({ open, onOpenChange, group, nextSort }: GroupDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent title={group ? `Edit ${group.name}` : "Add group"}>
      <GroupForm group={group} nextSort={nextSort} onDone={() => onOpenChange(false)} />
    </DialogContent>
  </Dialog>
);
