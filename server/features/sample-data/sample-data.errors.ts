import { apiError, notFound } from '../../utils/errors'

export const SampleDataErrorCodes = {
  SAMPLE_MENU_NOT_EMPTY: 'SAMPLE_MENU_NOT_EMPTY',
  SAMPLE_MENU_LOADED: 'SAMPLE_MENU_LOADED',
  SAMPLE_MENU_OTHER_SIZE: 'SAMPLE_MENU_OTHER_SIZE',
  SAMPLE_DATA_BUSY: 'SAMPLE_DATA_BUSY',
} as const

/** Off in this environment (production): the routes don't exist. */
export const sampleDataOff = () => notFound('This page')

export const menuNotEmpty = () =>
  apiError(409, SampleDataErrorCodes.SAMPLE_MENU_NOT_EMPTY, 'The menu already has data. Reset it to load the sample menu.')

export const menuAlreadyLoaded = () =>
  apiError(409, SampleDataErrorCodes.SAMPLE_MENU_LOADED, 'The sample menu is already loaded. Reset it to load again.')

export const otherSizeRunning = (size: string) =>
  apiError(409, SampleDataErrorCodes.SAMPLE_MENU_OTHER_SIZE, `A ${size} sample menu is partly loaded. Continue it, or reset the menu first.`)

export const sampleDataBusy = () =>
  apiError(409, SampleDataErrorCodes.SAMPLE_DATA_BUSY, 'Sample data is loading in another tab or by another admin. Try again in a minute.')
