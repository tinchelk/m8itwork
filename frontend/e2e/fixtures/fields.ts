import { type Locator } from "@playwright/test";

// Exercise the rendered web menu rather than writing its hidden form value.
export async function chooseOption(control: Locator, value: string) {
  await control.click();
  await control.page().locator(`.field-option[data-value=${JSON.stringify(value)}]`).click();
}
