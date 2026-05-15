-- Migration: Add 'dealer' value to user_role enum
-- This must run before any dealer user records are inserted.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'dealer';
