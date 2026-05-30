const controller = require('../../src/api/podcast/controllers/podcast');

describe('podcast controller', () => {
  const mockPodcast = {
    id: 10,
    slug: 'test-ep',
    title: 'Test Episode',
    series: null
  };

  beforeAll(() => {
    global.strapi = {
      entityService: {
        findOne: jest.fn().mockResolvedValue(mockPodcast),
        findMany: jest.fn().mockResolvedValue([mockPodcast])
      },
      log: { error: jest.fn() }
    };
  });

  afterAll(() => {
    delete global.strapi;
  });

  test('full returns podcast and list when id provided', async () => {
    const ctx = { params: { id: 10 }, send: jest.fn(), badRequest: jest.fn(), notFound: jest.fn() };
    await controller.full(ctx);
    expect(ctx.send).toHaveBeenCalled();
    const res = ctx.send.mock.calls[0][0];
    expect(res.podcast).toBeDefined();
    expect(res.list).toBeDefined();
  });

  test('fullBySlug returns podcast and list when slug provided', async () => {
    // override findMany to return an array for slug lookup
    global.strapi.entityService.findMany = jest.fn().mockResolvedValue([mockPodcast]);
    const ctx = { params: { slug: 'test-ep' }, send: jest.fn(), badRequest: jest.fn(), notFound: jest.fn() };
    await controller.fullBySlug(ctx);
    expect(ctx.send).toHaveBeenCalled();
    const res = ctx.send.mock.calls[0][0];
    expect(res.podcast).toBeDefined();
    expect(res.list).toBeDefined();
  });
});
