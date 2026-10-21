//go:build linux

package mountfs

import (
	"context"
	"github.com/hanwen/go-fuse/v2/fs"
	"github.com/hanwen/go-fuse/v2/fuse"
	"io"
	"strings"
	"syscall"
	"time"
)

type Node struct {
	fs.Inode
	View *View
	Path string
}

func (n *Node) Lookup(ctx context.Context, name string, out *fuse.EntryOut) (*fs.Inode, syscall.Errno) {
	if !n.View.Authorized() {
		return nil, syscall.EACCES
	}
	p := name
	if n.Path != "" {
		p = n.Path + "/" + name
	}
	idx := n.View.Current()
	if idx == nil {
		return nil, syscall.EIO
	}
	mode := uint32(syscall.S_IFDIR)
	if f, ok := idx.Files[p]; ok {
		mode = syscall.S_IFREG
		out.Mode = mode | f.Mode
		out.Size = uint64(f.Size)
	} else {
		found := false
		for f := range idx.Files {
			if strings.HasPrefix(f, p+"/") {
				found = true
				break
			}
		}
		if !found {
			return nil, syscall.ENOENT
		}
		out.Mode = mode | 0555
	}
	child := n.NewInode(ctx, &Node{View: n.View, Path: p}, fs.StableAttr{Mode: mode})
	return child, 0
}
func (n *Node) Readdir(ctx context.Context) (fs.DirStream, syscall.Errno) {
	if !n.View.Authorized() {
		return nil, syscall.EACCES
	}
	entries := []fuse.DirEntry{}
	idx := n.View.Current()
	if idx == nil {
		return nil, syscall.EIO
	}
	for _, name := range n.View.Entries(n.Path) {
		p := name
		if n.Path != "" {
			p = n.Path + "/" + name
		}
		mode := uint32(syscall.S_IFDIR)
		if _, ok := idx.Files[p]; ok {
			mode = syscall.S_IFREG
		}
		entries = append(entries, fuse.DirEntry{Name: name, Mode: mode})
	}
	return fs.NewListDirStream(entries), 0
}
func (n *Node) Getattr(ctx context.Context, f fs.FileHandle, out *fuse.AttrOut) syscall.Errno {
	if !n.View.Authorized() {
		return syscall.EACCES
	}
	out.Mode = syscall.S_IFDIR | 0555
	idx := n.View.Current()
	if idx != nil {
		if file, ok := idx.Files[n.Path]; ok {
			out.Mode = syscall.S_IFREG | file.Mode
			out.Size = uint64(file.Size)
		}
	}
	return 0
}
func (n *Node) Open(ctx context.Context, flags uint32) (fs.FileHandle, uint32, syscall.Errno) {
	if flags&uint32(syscall.O_WRONLY|syscall.O_RDWR|syscall.O_APPEND|syscall.O_TRUNC) != 0 {
		return nil, 0, syscall.EROFS
	}
	h, e := n.View.Open(ctx, n.Path)
	if e != nil {
		return nil, 0, syscall.EIO
	}
	return &fileHandle{h}, fuse.FOPEN_DIRECT_IO, 0
}

type fileHandle struct{ h *Handle }

func (f *fileHandle) Read(ctx context.Context, dest []byte, off int64) (fuse.ReadResult, syscall.Errno) {
	n, e := f.h.ReadAt(dest, off)
	if e != nil && e != io.EOF {
		return nil, syscall.EACCES
	}
	return fuse.ReadResultData(dest[:n]), 0
}
func Mount(ctx context.Context, v *View, path string) error {
	zero := time.Duration(0)
	server, e := fs.Mount(path, &Node{View: v}, &fs.Options{MountOptions: fuse.MountOptions{Options: []string{"ro", "default_permissions"}, FsName: "skiva", Name: "skills"}, EntryTimeout: &zero, AttrTimeout: &zero, NegativeTimeout: &zero})
	if e != nil {
		return e
	}
	go v.Run(ctx)
	go func() { <-ctx.Done(); server.Unmount() }()
	server.Wait()
	return nil
}

func (f *fileHandle) Release(ctx context.Context) syscall.Errno { f.h.Close(); return 0 }
