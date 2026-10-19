// The model every file of the type-cost reference project extends, and that the usages of bench/types/usages/ import
// as `Model`: nested objects, arrays, optional and nullable fields, a union, and a recursion through `children`, the
// shapes a path or a schema type must walk in application code.
export interface Model {
  readonly id: string;
  readonly total: number;
  readonly status: 'draft' | 'sent' | 'paid';
  readonly tags: readonly string[];
  readonly customer: {
    readonly name: string;
    readonly email?: string;
    readonly address: { readonly street: string; readonly city: string; readonly zip: string | null };
  };
  readonly lines: readonly { readonly sku: string; readonly quantity: number; readonly unitPrice: number }[];
  readonly children?: readonly Model[];
}
