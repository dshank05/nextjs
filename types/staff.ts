// Staff, Mechanic, and Customer types

export interface Staff {
  id: number;
  name: string;
  phone: string;
  email?: string;
  status: string;
}

export interface StaffDetails {
  id: string;
  staff_name: string;
}

export interface Mechanic {
  id: number;
  name: string;
  phone: string;
  status: string;
}

export interface MechanicDetails {
  id: string;
  mechanic_name: string;
}

export interface Customer {
  id: string;
  billing_name: string;
  contact_no?: string;
  email?: string;
  billing_gstin?: string;
  billing_address?: string;
  billing_address_2?: string;
  billing_city?: string;
  billing_state?: string;
  billing_state_code?: number;
  billing_pin_code?: string;
}
