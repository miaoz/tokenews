export default {
  fetch(request) {
    const url = new URL(request.url);
    url.protocol = "https:";
    url.hostname = "tokenews.xyz";
    return Response.redirect(url.toString(), 301);
  },
};
