# Vendor Boundary / 上游移植边界

This directory is reserved for reviewed, license-compatible selective ports or immutable upstream snapshots required by an approved import task.

Rules:

- do not add a Git submodule or subtree;
- do not place an entire upstream application here;
- pin the exact commit;
- preserve notices;
- map every file in `docs/PROVENANCE.yml`;
- keep imported code isolated until adapted and tested;
- never fetch or update it automatically at build or runtime.

当前目录为空是正常状态。
