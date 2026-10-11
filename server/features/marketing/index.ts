// Public API of the marketing feature (step M2a, D164): channels and posts.
export { cancelChannelLink, cancelPost, confirmChannelLink, createChannelLink, createPosts, deliverDuePosts, disconnectChannel, getChannelLink, handleChannelUpdate, listChannels, listPosts, retryPost } from './marketing.service'
export type { PostDeliveryReport, ReadObject } from './marketing.service'
export { MarketingErrorCodes } from './marketing.errors'
